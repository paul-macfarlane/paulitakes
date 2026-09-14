import "server-only";

// Pure DB access for the posts server actions (create/update/delete, staged
// drafts, lifecycle transitions) — queries/mutations plus error
// classification only. Business rules (what to write, when, and why) live in
// src/lib/posts/service/*.

import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  not,
  notExists,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db, type Db } from "@/db";
import {
  categories,
  comments,
  postDrafts,
  posts,
  postTags,
  tags,
} from "@/db/schema";
import type { StaffSession } from "@/lib/auth/guards";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import {
  tagToSlug,
  type PostDraft,
  type PostInput,
  type SavedPost,
} from "@/lib/posts/input";
import {
  PostStatus,
  PUBLIC_STATUSES,
  isPubliclyVisible,
  usesDraftBuffer,
} from "@/lib/posts/status";
import { NOT_AUTHORIZED_ERROR } from "@/lib/shared/action-result";
// Cross-domain tx type (mirrors how comments/data.ts's
// anonymizeCommentsForUser types its `tx` param): deleteNeverPublicPostsForUser
// is composed inside the users domain's account-deletion transaction, not a
// posts-domain-internal one, so it borrows that domain's Tx alias rather than
// the local `Tx` below (which is for posts-internal multi-step writes).
import type { Tx as UsersTx } from "@/lib/users/data";

// node-postgres surfaces Postgres error codes (and the violated constraint
// name) as `.code`/`.constraint` on the thrown error; drizzle's
// node-postgres driver rethrows it as-is, but walk `.cause` too in case a
// wrapper ever gets introduced between here and the driver. Returns the
// constraint name for a unique_violation (23505), null otherwise — callers
// scope their handling by constraint (e.g. only `posts_slug_unique` means
// "That slug is taken."; a post_tags PK collision is a different situation
// entirely and must not be mapped to the same message).
function uniqueViolationConstraint(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") {
    const constraint = (err as { constraint?: unknown }).constraint;
    return typeof constraint === "string" ? constraint : "";
  }
  const cause = (err as { cause?: unknown }).cause;
  return cause !== undefined && cause !== err
    ? uniqueViolationConstraint(cause)
    : null;
}

// Exact constraint match — tags_slug_unique / categories_slug_unique must
// not be misread as a post-slug collision. A 23505 with no constraint name
// (helper returns "") is attributed to the post slug too: it's the only
// unique constraint these actions can hit un-shielded (tag writes use
// onConflictDoNothing), and dropping the actionable "slug is taken" error
// because a driver omitted metadata would be the worse failure.
export function isPostSlugCollision(err: unknown): boolean {
  const constraint = uniqueViolationConstraint(err);
  return constraint === "posts_slug_unique" || constraint === "";
}

export async function categoryExists(categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  return row !== undefined;
}

// Transaction type accepted by `db.transaction(async (tx) => ...)` — both
// the Neon and node-postgres drivers behind `Db` share this shape.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Tag names as typed by the author -> upserted rows attached to the post.
// Normalizes (trim, dedupe by derived slug, drop empties), upserts any new
// tags, then replaces the post's full tag set in one go.
export async function setPostTags(
  tx: Tx,
  postId: string,
  tagNames: string[],
): Promise<void> {
  const bySlug = new Map<string, string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const slug = tagToSlug(name);
    // Defense in depth: the tag input schema already rejects unslugifiable
    // names, but skip rather than collapse if one ever slips through.
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, name);
  }

  await tx.delete(postTags).where(eq(postTags.postId, postId));

  if (bySlug.size === 0) return;

  await tx
    .insert(tags)
    .values([...bySlug.entries()].map(([slug, name]) => ({ slug, name })))
    .onConflictDoNothing({ target: tags.slug });

  const tagRows = await tx
    .select({ id: tags.id, slug: tags.slug })
    .from(tags)
    .where(inArray(tags.slug, [...bySlug.keys()]));

  await tx
    .insert(postTags)
    .values(tagRows.map((row) => ({ postId, tagId: row.id })))
    // Makes concurrent same-post tag saves idempotent instead of raising
    // 23505 on the composite (post_id, tag_id) PK.
    .onConflictDoNothing();
}

export async function insertPost(
  slug: string,
  data: PostInput,
  authorId: string,
): Promise<{ id: string; slug: string; editVersion: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posts)
      .values({
        authorId,
        title: data.title,
        slug,
        bodyMd: data.bodyMd,
        thumbnailUrl: data.thumbnailUrl,
        bannerUrl: data.bannerUrl,
        videoUrl: data.videoUrl,
        categoryId: data.categoryId,
      })
      .returning({
        id: posts.id,
        slug: posts.slug,
        editVersion: posts.editVersion,
      });

    await setPostTags(tx, row!.id, data.tags);

    return row!;
  });
}

// The post's current tag NAMES — the seed for a draft snapshot's tags on the
// first staged edit (before a post_drafts row exists to carry them).
export async function loadPostTagNames(postId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(postTags.postId, postId));
  return rows.map((row) => row.name);
}

// Existing row loaded by updatePost to decide direct-write vs staged-draft
// and to run the ownership check.
export type ExistingPostForUpdate = {
  editVersion: string;
  authorId: string;
  slug: string;
  status: PostStatus;
  publishAt: Date | null;
  archiveAt: Date | null;
};

export async function loadPostForUpdate(
  id: string,
): Promise<ExistingPostForUpdate | undefined> {
  const [row] = await db
    .select({
      editVersion: posts.editVersion,
      authorId: posts.authorId,
      slug: posts.slug,
      status: posts.status,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  return row;
}

// Thrown inside writePostColumns's transaction to roll back and surface the
// public-thumbnail invariant when a concurrent publish wins the race.
class ThumbnailInvariantError extends Error {}

export type WritePostColumnsResult =
  | { ok: true; editVersion: string }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "thumbnail-invariant" }
  | { ok: false; reason: "slug-collision" };

// contentUpdatedAt is excluded so the "exactly one writer" invariant
// (ADR-0016) is compiler-enforced: only promoteStagedDraft's inline .set()
// may stamp it — never a direct column write or lifecycle transition.
export type PostColumnUpdate = Omit<
  Partial<typeof posts.$inferInsert>,
  "contentUpdatedAt"
>;

// Applies a direct (non-staged) column update to a post, optionally guarded
// against the public-thumbnail invariant, and replaces its tag set in the
// same transaction when `opts.tags` is provided. Used by updatePost for
// draft/archived posts and any scheduled-but-not-yet-public post (writes
// that go straight to the live columns, not into the draft buffer).
export async function writePostColumns(
  id: string,
  columnUpdates: PostColumnUpdate,
  opts: {
    guardThumbnailInvariant: boolean;
    tags?: string[];
    expectedVersion: string;
  },
): Promise<WritePostColumnsResult> {
  try {
    return await db.transaction(async (tx): Promise<WritePostColumnsResult> => {
      const post = await lockPostRow(tx, id);
      if (
        !post ||
        post.editVersion !== opts.expectedVersion ||
        isPubliclyVisible(post)
      ) {
        return { ok: false, reason: "conflict" };
      }
      if (Object.keys(columnUpdates).length === 0 && opts.tags === undefined) {
        return { ok: true, editVersion: post.editVersion };
      }
      // When clearing the thumbnail, guard the write on the status still
      // being draft/archived — a concurrent publish between our read and
      // this write would otherwise slip a "" thumbnail onto a live post.
      const updated = await tx
        .update(posts)
        .set({ ...columnUpdates, editVersion: crypto.randomUUID() })
        .where(
          opts.guardThumbnailInvariant
            ? and(
                eq(posts.id, id),
                notInArray(posts.status, [...PUBLIC_STATUSES]),
              )
            : eq(posts.id, id),
        )
        .returning({ id: posts.id, editVersion: posts.editVersion });

      if (opts.guardThumbnailInvariant && updated.length === 0) {
        throw new ThumbnailInvariantError();
      }

      if (opts.tags !== undefined) {
        await setPostTags(tx, id, opts.tags);
      }
      return { ok: true, editVersion: updated[0]!.editVersion };
    });
  } catch (err) {
    if (err instanceof ThumbnailInvariantError) {
      return { ok: false, reason: "thumbnail-invariant" };
    }
    // Unlike create, an explicit slug edit that collides is not retried — the
    // author picked that slug on purpose and should choose another.
    // isPostSlugCollision scopes the mapping: a post_tags PK collision (or any
    // other unique violation) must not surface as "That slug is taken."
    if (isPostSlugCollision(err)) {
      return { ok: false, reason: "slug-collision" };
    }
    throw err;
  }
}

export async function deletePostRow(
  id: string,
): Promise<{ id: string; slug: string } | undefined> {
  const [deleted] = await db
    .delete(posts)
    .where(eq(posts.id, id))
    .returning({ id: posts.id, slug: posts.slug });
  return deleted;
}

// Never-public predicate shared by deleteOwnNeverPublicPost (below) and
// deleteNeverPublicPostsForUser: status alone can't prove "never public" —
// published -> draft is a legal transition (ALLOWED_TRANSITIONS, status.ts)
// leaving a formerly-live post sitting in `draft`, and a scheduled post
// whose publish_at has already arrived is live right now even though its
// status is still `scheduled` until the cron normalizes it. So a post only
// counts as never-public when it's draft/scheduled AND its publish_at is
// either unset or still in the future.
function neverPublicGuard(now: Date): SQL {
  return and(
    inArray(posts.status, [PostStatus.Draft, PostStatus.Scheduled]),
    or(isNull(posts.publishAt), gt(posts.publishAt, now)),
  )!;
}

// Guards a post delete against a bystander comment thread: a formerly-public
// post that was reverted to draft (see neverPublicGuard above) may still
// have real reader comments on it, and deleting the post would cascade-
// delete those (comments.postId onDelete: "cascade", schema.ts) — so a
// never-public post with any comment at all is excluded from both delete
// paths below.
function noCommentsGuard(): SQL {
  return notExists(
    db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.postId, posts.id)),
  );
}

// "This post is eligible for the never-public purge" — the single predicate
// shared by deleteNeverPublicPostsForUser (the purge) and
// userHasUndeletablePosts (its refusal-check complement, below) so the two
// can never drift apart. Both take the SAME `now` from their caller
// (prepareAccountDeletion, src/lib/users/service.ts) so the refusal check
// and the purge agree on "now" even though they run as separate statements
// inside the same transaction.
function purgeablePostGuard(now: Date): SQL {
  return and(neverPublicGuard(now), noCommentsGuard())!;
}

// Author-initiated hard delete (ACCT-1's sibling feature): authors may only
// remove their OWN posts that have never gone public and have no comments —
// see neverPublicGuard/noCommentsGuard above for why status alone isn't
// enough. Postgres evaluates the whole WHERE atomically with the DELETE, so
// this is race-safe with no separate existence check or transaction (house
// style, cf. hardDeleteCommentIfChildless in src/lib/comments/data.ts).
export async function deleteOwnNeverPublicPost(
  id: string,
  authorId: string,
): Promise<{ id: string; slug: string } | undefined> {
  const [deleted] = await db
    .delete(posts)
    .where(
      and(
        eq(posts.id, id),
        eq(posts.authorId, authorId),
        neverPublicGuard(new Date()),
        noCommentsGuard(),
      ),
    )
    .returning({ id: posts.id, slug: posts.slug });
  return deleted;
}

// Bulk-reassigns every post authored by `fromUserId` to `toUserId` — the
// account-deletion ownership-transfer flow (ACCT-1 follow-up) and the first
// bulk post UPDATE in the codebase. Returns the affected slugs so the caller
// can revalidate their `post:{slug}` cache tags (a transferred post may have
// been public at some point and still be cached under its old tag, even
// though the tag's key — the slug — doesn't change).
export async function transferPostsOwnership(
  fromUserId: string,
  toUserId: string,
): Promise<{ slug: string }[]> {
  return db
    .update(posts)
    .set({ authorId: toUserId })
    .where(eq(posts.authorId, fromUserId))
    .returning({ slug: posts.slug });
}

// Same never-public + no-comments predicate as deleteOwnNeverPublicPost
// (via purgeablePostGuard), scoped by `userId` rather than an acting
// session's ownership check (there is no acting session — this runs as part
// of the account-deletion flow deleting the user's OWN posts). Takes `tx`
// because it's composed inside the users domain's account-deletion
// transaction, matching how anonymizeCommentsForUser (src/lib/comments/data.ts)
// is tx-composed for the same flow. No cache revalidation here: a
// never-public post was never visible, so it was never cached under any tag
// — nothing to invalidate. Callers MUST run userHasUndeletablePosts (below)
// against the same `now` and get a clean refusal-free result BEFORE calling
// this — see that function's comment for why (prepareAccountDeletion,
// src/lib/users/service.ts, is the only caller and enforces the order).
export async function deleteNeverPublicPostsForUser(
  tx: UsersTx,
  userId: string,
  now: Date,
): Promise<{ id: string }[]> {
  return tx
    .delete(posts)
    .where(and(eq(posts.authorId, userId), purgeablePostGuard(now)))
    .returning({ id: posts.id });
}

// The account-deletion refusal check (prepareAccountDeletion,
// src/lib/users/service.ts): true when this user has authored at least one
// post that would SURVIVE deleteNeverPublicPostsForUser's purge (an
// ever-public post, or a never-public one with a real comment thread) — the
// exact negation of purgeablePostGuard, so the two can't drift.
//
// INVARIANT: this must run, and the delete must be refused, BEFORE any write
// happens — including the purge itself. All of prepareAccountDeletion's
// refusal checks run before any write because withLockedUserMutation's
// transaction COMMITS when its callback resolves normally and only
// ROLLBACKs on throw; a refusal that returned `{ ok: false }` after the
// purge had already run would still commit the purge (drafts permanently
// gone from a deletion the caller was told was refused). Takes the same
// `now` the caller passes to deleteNeverPublicPostsForUser so the check and
// the purge agree on "now" even though they're separate statements in the
// same tx; if publish_at flips between them anyway, a surviving post still
// blocks the user-row delete via posts.authorId's FK staying RESTRICT (no
// onDelete, schema.ts) — a backstop, not the primary guard.
export async function userHasUndeletablePosts(
  tx: UsersTx,
  userId: string,
  now: Date,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.authorId, userId), not(purgeablePostGuard(now))))
    .limit(1);
  return row !== undefined;
}

// Column selection for a LEFT JOINed post_drafts row, reused by every read
// site that overlays the staged snapshot (loadOwnedDraft, loadStageDraftBase,
// and the admin.ts read overlay) so the shape can't drift between them.
// `draftPostId` is the presence sentinel: every other post_drafts column is
// NOT NULL at the table level, so they're only possibly-null here because of
// the LEFT JOIN (no row joined = no pending changes).
export const draftJoinColumns = {
  draftPostId: postDrafts.postId,
  draftTitle: postDrafts.title,
  draftSlug: postDrafts.slug,
  draftBodyMd: postDrafts.bodyMd,
  draftCategoryId: postDrafts.categoryId,
  draftThumbnailUrl: postDrafts.thumbnailUrl,
  draftBannerUrl: postDrafts.bannerUrl,
  draftVideoUrl: postDrafts.videoUrl,
  draftTags: postDrafts.tags,
  draftUpdatedAt: postDrafts.updatedAt,
} as const;

type DraftJoinRow = {
  draftPostId: string | null;
  draftTitle: string | null;
  draftSlug: string | null;
  draftBodyMd: string | null;
  draftCategoryId: number | null;
  draftThumbnailUrl: string | null;
  draftBannerUrl: string | null;
  draftVideoUrl: string | null;
  draftTags: string[] | null;
  draftUpdatedAt: Date | null;
};

// Reassembles the PostDraft snapshot (postDraftSchema shape) from a row
// selected with draftJoinColumns, or null when no post_drafts row was
// joined (no pending changes).
export function draftFromJoinRow(row: DraftJoinRow): PostDraft | null {
  if (row.draftPostId === null) return null;
  return {
    title: row.draftTitle!,
    slug: row.draftSlug!,
    bodyMd: row.draftBodyMd!,
    categoryId: row.draftCategoryId!,
    thumbnailUrl: row.draftThumbnailUrl!,
    bannerUrl: row.draftBannerUrl,
    videoUrl: row.draftVideoUrl,
    tags: row.draftTags ?? [],
  };
}

// Loads the draft-buffer columns and runs the shared ownership check for the
// publish/discard actions (the counterpart to loadOwnedLifecycle for the
// status actions). One source of truth for the ownership predicate so it
// can't drift.
export async function loadOwnedDraft(
  id: string,
  session: StaffSession,
): Promise<
  | {
      ok: true;
      post: {
        slug: string;
        draft: PostDraft | null;
        draftUpdatedAt: Date | null;
      };
    }
  | { ok: false; error: string }
> {
  const [existing] = await db
    .select({
      authorId: posts.authorId,
      slug: posts.slug,
      ...draftJoinColumns,
    })
    .from(posts)
    .leftJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .where(eq(posts.id, id))
    .limit(1);

  if (!existing) return { ok: false, error: "Post not found." };
  if (
    !canPerformAction(session.user, Action.ManageAnyPost) &&
    existing.authorId !== session.user.id
  ) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }
  return {
    ok: true,
    post: {
      slug: existing.slug,
      draft: draftFromJoinRow(existing),
      draftUpdatedAt: existing.draftUpdatedAt,
    },
  };
}

// Row shape used by stageDraftEdit (src/lib/posts/service/crud.ts) to build
// the merge base and the "reverted to live" comparison.
export type StageDraftBaseRow = {
  draft: PostDraft | null;
  draftUpdatedAt: Date | null;
  title: string;
  slug: string;
  bodyMd: string;
  categoryId: number;
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
};

export async function loadStageDraftBase(
  id: string,
): Promise<StageDraftBaseRow | undefined> {
  const [row] = await db
    .select({
      title: posts.title,
      slug: posts.slug,
      bodyMd: posts.bodyMd,
      categoryId: posts.categoryId,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
      ...draftJoinColumns,
    })
    .from(posts)
    .leftJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .where(eq(posts.id, id))
    .limit(1);
  if (!row) return undefined;
  return {
    title: row.title,
    slug: row.slug,
    bodyMd: row.bodyMd,
    categoryId: row.categoryId,
    thumbnailUrl: row.thumbnailUrl,
    bannerUrl: row.bannerUrl,
    videoUrl: row.videoUrl,
    draft: draftFromJoinRow(row),
    draftUpdatedAt: row.draftUpdatedAt,
  };
}

// Immediate slug-collision check for a staged edit (parity with the
// live-write path): the staged slug lives in post_drafts with no unique
// constraint, so a clash would otherwise stay hidden until publish.
export async function findSlugClash(
  slug: string,
  excludingId: string,
): Promise<boolean> {
  const [clash] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), ne(posts.id, excludingId)))
    .limit(1);
  return clash !== undefined;
}

// Null-safe "this column still holds the value we read" guard, for CAS on
// nullable timestamp columns.
export function unchanged(column: PgColumn, value: Date | null): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

// Null-safe equality on the CAS token, compared in memory (post_drafts.
// updated_at, once the row's been read inside the caller's transaction)
// rather than as a SQL predicate — the caller already holds the row lock, so
// there's no race between reading it and comparing.
function sameTimestamp(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

// Held for the rest of the caller's transaction, so every draft-buffer write
// for the same post (stage, clear, promote) serializes against the others —
// the same guarantee the old single `UPDATE posts SET draft = ...` CAS
// statement got for free from Postgres row locking, now that the buffer
// lives in its own table (ADR-0012). Returns the row's status (callers also
// need "is this post still publicly visible?"), or undefined if the post no
// longer exists.
async function lockPostRow(
  tx: Tx,
  id: string,
): Promise<ExistingPostForUpdate | undefined> {
  const [row] = await tx
    .select({
      status: posts.status,
      editVersion: posts.editVersion,
      authorId: posts.authorId,
      slug: posts.slug,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .for("update");
  return row;
}

// Reads the current post_drafts row's CAS token inside the caller's
// transaction (which must already hold the post row lock from lockPostRow).
async function readDraftUpdatedAt(tx: Tx, id: string): Promise<Date | null> {
  const [row] = await tx
    .select({ updatedAt: postDrafts.updatedAt })
    .from(postDrafts)
    .where(eq(postDrafts.postId, id))
    .limit(1);
  return row?.updatedAt ?? null;
}

// Even an explicit no-op flush must prove the editor is current before a
// lifecycle control can proceed. Do not return a newly read token to a stale UI.
export async function checkEditVersion(
  id: string,
  expectedVersion: string,
): Promise<SavedPost | null> {
  return db.transaction(async (tx) => {
    const post = await lockPostRow(tx, id);
    if (!post || post.editVersion !== expectedVersion) return null;
    const [draft] = usesDraftBuffer(post.status)
      ? await tx
          .select({ slug: postDrafts.slug })
          .from(postDrafts)
          .where(eq(postDrafts.postId, id))
      : [];
    return {
      id,
      slug: draft?.slug ?? post.slug,
      editVersion: post.editVersion,
    };
  });
}

// Every staged mutation invalidates the parent editor identity in the same
// transaction. The parent lock serializes it with direct/lifecycle writes.
async function advanceEditVersion(tx: Tx, id: string): Promise<string> {
  const [row] = await tx
    .update(posts)
    .set({ editVersion: crypto.randomUUID() })
    .where(eq(posts.id, id))
    .returning({ editVersion: posts.editVersion });
  return row!.editVersion;
}

export async function clearStagedDraft(
  id: string,
  expectedVersion: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const post = await lockPostRow(tx, id);
    if (
      !post ||
      post.editVersion !== expectedVersion ||
      !isPubliclyVisible(post)
    )
      return null;
    const removed = await tx
      .delete(postDrafts)
      .where(eq(postDrafts.postId, id))
      .returning({ id: postDrafts.postId });
    return removed.length ? advanceEditVersion(tx, id) : post.editVersion;
  });
}

export async function writeStagedDraft(
  id: string,
  expectedVersion: string,
  snapshot: PostDraft,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const post = await lockPostRow(tx, id);
    if (
      !post ||
      post.editVersion !== expectedVersion ||
      !isPubliclyVisible(post)
    )
      return null;
    await tx
      .insert(postDrafts)
      .values({ postId: id, ...snapshot, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: postDrafts.postId,
        set: { ...snapshot, updatedAt: new Date() },
      });
    return advanceEditVersion(tx, id);
  });
}

// Promotes a staged snapshot to the live columns and clears the buffer, in
// one transaction (ADR-0011), serializing against any concurrent
// stage/clear/promote via the post row lock (ADR-0012). A concurrent
// autosave that re-staged newer edits between the caller's read and here
// changes updated_at, matching nothing here, so the transaction rolls back
// and the caller reports a conflict instead of promoting a stale snapshot
// and discarding the newer one.
export async function promoteStagedDraft(
  id: string,
  draftUpdatedAt: Date | null,
  draft: PostDraft,
): Promise<"promoted" | "conflict" | "slug-collision"> {
  try {
    const promoted = await db.transaction(async (tx) => {
      const post = await lockPostRow(tx, id);
      if (!post) return false;

      const current = await readDraftUpdatedAt(tx, id);
      if (!sameTimestamp(draftUpdatedAt, current)) return false;

      const rows = await tx
        .update(posts)
        .set({
          title: draft.title,
          slug: draft.slug,
          bodyMd: draft.bodyMd,
          categoryId: draft.categoryId,
          thumbnailUrl: draft.thumbnailUrl,
          bannerUrl: draft.bannerUrl,
          videoUrl: draft.videoUrl,
          // Readers see new content starting now — the only writer of this
          // column (POST-10).
          contentUpdatedAt: new Date(),
        })
        .where(eq(posts.id, id))
        .returning({ id: posts.id });
      if (rows.length === 0) return false;

      if (current !== null) {
        await tx.delete(postDrafts).where(eq(postDrafts.postId, id));
      }
      await setPostTags(tx, id, draft.tags);
      return true;
    });

    return promoted ? "promoted" : "conflict";
  } catch (err) {
    // A staged slug that now collides with another post's live slug: the
    // whole tx rolls back, so the buffer survives for the author to fix.
    if (isPostSlugCollision(err)) return "slug-collision";
    throw err;
  }
}

// Unconditional (no CAS): a discard never conflicts with a concurrent stage,
// only with a concurrent promote, and it always wins that race. Still locks
// the post row first, matching every other draft-buffer mutator (lockPostRow,
// then post_drafts): that shared lock ordering is what actually serializes
// discard against stage/promote, so the two can't interleave.
export async function clearPostDraftUnconditional(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const post = await lockPostRow(tx, id);
    if (!post) return;
    const removed = await tx
      .delete(postDrafts)
      .where(eq(postDrafts.postId, id))
      .returning({ id: postDrafts.postId });
    if (removed.length) await advanceEditVersion(tx, id);
  });
}

// Lifecycle columns loaded together by the status/schedule actions below.
// `hasDraft` (not the buffer itself — just whether a post_drafts row exists)
// lets the lifecycle actions reject while a public post has unpublished
// staged edits.
export type LifecycleRow = {
  authorId: string;
  slug: string;
  status: PostStatus;
  thumbnailUrl: string;
  publishAt: Date | null;
  archiveAt: Date | null;
  hasDraft: boolean;
};

// Loads the lifecycle columns and runs the shared ownership check (authors
// scoped to their own rows, admins unscoped; §5.7). Returns the row, or an
// ActionResult error to hand straight back to the caller.
export async function loadOwnedLifecycle(
  id: string,
  session: StaffSession,
): Promise<{ ok: true; post: LifecycleRow } | { ok: false; error: string }> {
  const [existing] = await db
    .select({
      authorId: posts.authorId,
      slug: posts.slug,
      status: posts.status,
      thumbnailUrl: posts.thumbnailUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
      hasDraft: sql<boolean>`exists (select 1 from ${postDrafts} where ${postDrafts.postId} = ${posts.id})`,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);

  if (!existing) return { ok: false, error: "Post not found." };
  if (
    !canPerformAction(session.user, Action.ManageAnyPost) &&
    existing.authorId !== session.user.id
  ) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }
  return { ok: true, post: existing };
}

// Applies `updates` only while the post still matches the state we read
// (compare-and-swap): always guards on `fromStatus`, plus any `extraGuards`
// (e.g. a sibling timestamp unchanged) so a concurrent lifecycle change on
// another tab/device matches no row. That lets the caller report a conflict
// instead of silently clobbering the other write — and, for the schedule
// actions, prevents a race from committing publish_at >= archive_at behind
// each action's individually-valid check. Returns whether the write landed.
export async function casUpdate(
  id: string,
  fromStatus: PostStatus,
  updates: PostColumnUpdate,
  extraGuards: SQL[] = [],
): Promise<boolean> {
  const updated = await db
    .update(posts)
    .set(updates)
    .where(and(eq(posts.id, id), eq(posts.status, fromStatus), ...extraGuards))
    .returning({ id: posts.id });
  return updated.length > 0;
}

// Draft-buffer-empty guard shared by the lifecycle CAS writes below: the
// hasDraft check in loadOwnedLifecycle is read-time, so a concurrent
// first-stage edit could otherwise commit a buffer while a transition/
// schedule flips the post off the public track — stranding an invisible,
// unresolvable snapshot (ADR-0011). If a buffer landed, the guarded write
// below matches no row and the caller reports a conflict.
function noPendingDraftGuard(): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(postDrafts)
      .where(eq(postDrafts.postId, posts.id)),
  );
}

// transitionPostStatus's write, keyed on the columns it needs to change
// (status, and the publishAt/archiveAt side-effects the service computed).
export async function casTransitionStatus(
  id: string,
  fromStatus: PostStatus,
  updates: PostColumnUpdate,
): Promise<boolean> {
  return casUpdate(id, fromStatus, updates, [noPendingDraftGuard()]);
}

// schedulePublish's write: CAS also guards archive_at unchanged (so a
// concurrent scheduleArchive can't slip a nearer archive_at past the
// service's pre-check, leaving publish_at >= archive_at) and `draft is null`.
export async function casSchedulePublish(
  id: string,
  fromStatus: PostStatus,
  publishAt: Date,
  currentArchiveAt: Date | null,
): Promise<boolean> {
  return casUpdate(
    id,
    fromStatus,
    { status: PostStatus.Scheduled, publishAt },
    [unchanged(posts.archiveAt, currentArchiveAt), noPendingDraftGuard()],
  );
}

// scheduleArchive's write: CAS also guards publish_at unchanged (mirror of
// schedulePublish, so a concurrent reschedule can't move publish_at past this
// archive time) and `draft is null`.
export async function casScheduleArchive(
  id: string,
  fromStatus: PostStatus,
  archiveAt: Date,
  currentPublishAt: Date | null,
): Promise<boolean> {
  return casUpdate(id, fromStatus, { archiveAt }, [
    unchanged(posts.publishAt, currentPublishAt),
    noPendingDraftGuard(),
  ]);
}

// cancelScheduledArchive's write: plain CAS on status, no extra guards.
export async function casCancelScheduledArchive(
  id: string,
  fromStatus: PostStatus,
): Promise<boolean> {
  return casUpdate(id, fromStatus, { archiveAt: null });
}
