import "server-only";

// Pure DB access for the comments domain (create/edit/delete, rate limiting,
// thread reads, moderation log, lock toggle) — queries/mutations only.
// Business rules live in src/lib/comments/service/*.

import { and, asc, count, desc, eq, gt, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { commentLikes, comments, posts, user } from "@/db/schema";
import { visiblePostsWhere } from "@/lib/posts/posts";
import { CommentStatus } from "@/lib/comments/status";
import type { CommentRow } from "@/lib/comments/tree";
import type { ModVerdictRecord } from "@/lib/comments/verdict";
import type { Tx } from "@/lib/users/data";

// Reused (not duplicated — engineering rule) from the posts domain: a
// comment can only land on a post that's publicly visible right now (design
// D7 step 3). Also used by the thread-read route for its 404 (D5).
export async function loadPostForComment(
  postId: string,
  now?: Date,
): Promise<{ commentsLocked: boolean } | undefined> {
  const [row] = await db
    .select({ commentsLocked: posts.commentsLocked })
    .from(posts)
    .where(and(eq(posts.id, postId), visiblePostsWhere(now)))
    .limit(1);
  return row;
}

// A reply's parent must exist, belong to the same post, and be currently
// `visible` (design D7 step 5) — replying to a held/rejected/deleted comment
// (or one on a different post) is rejected outright.
export async function parentIsValidForReply(
  parentId: string,
  postId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.id, parentId),
        eq(comments.postId, postId),
        eq(comments.status, CommentStatus.Visible),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// One of the two Postgres COUNTs behind the rate limit (design D6/§5.2 step
// 2) — counts ALL statuses (rejected/held spam still burns the limit).
// Window boundaries and the configured limits are the service's job
// (env-driven, not hardcoded here). Counts a row if EITHER it was created OR
// edited in the window: every moderated edit is a fresh moderation call
// (editOwnComment re-moderates on every save), so an edit burns the same
// budget as a create — this supersedes the original "edits don't count"
// design note, which left edit unbounded (fix, see create.ts's
// editOwnComment). The `(author_id, created_at)` index still serves the
// `author_id` prefix of this predicate; the `edited_at` side is an
// unindexed extra filter on an already-narrow per-author row set.
export async function countRecentCommentsByAuthor(
  authorId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(comments)
    .where(
      and(
        eq(comments.authorId, authorId),
        or(gt(comments.createdAt, since), gt(comments.editedAt, since)),
      ),
    );
  return row?.value ?? 0;
}

// Live windowed count behind auto-ban (CMT-10/ADR-0022, see
// src/lib/comments/service/auto-ban.ts): only currently-`rejected` rows count,
// so an admin restore (rejected -> visible) decrements it automatically —
// this is a fresh COUNT on every trigger, not a persisted tally. Counts a row
// if EITHER created_at OR edited_at falls in the window, same reasoning as
// countRecentCommentsByAuthor above: a flagged EDIT demotes an already-old
// comment to rejected, so its created_at is stale but edited_at is fresh, and
// that demotion must still count toward the window. The `(author_id,
// created_at)` index still serves the `author_id` prefix of this predicate;
// `status`/`edited_at` are unindexed extra filters on an already-narrow
// per-author row set (same tradeoff as countRecentCommentsByAuthor).
export async function countRejectedCommentsByAuthorSince(
  authorId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(comments)
    .where(
      and(
        eq(comments.authorId, authorId),
        eq(comments.status, CommentStatus.Rejected),
        or(gt(comments.createdAt, since), gt(comments.editedAt, since)),
      ),
    );
  return row?.value ?? 0;
}

// Mirrors uniqueViolationConstraint (src/lib/posts/data.ts) but for
// foreign_key_violation (23503): node-postgres surfaces the Postgres error
// code and violated constraint name as `.code`/`.constraint` on the thrown
// error; drizzle's node-postgres driver rethrows it as-is, but walk `.cause`
// too in case a wrapper is ever introduced between here and the driver.
function foreignKeyViolationConstraint(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  if (code === "23503") {
    const constraint = (err as { constraint?: unknown }).constraint;
    return typeof constraint === "string" ? constraint : "";
  }
  const cause = (err as { cause?: unknown }).cause;
  return cause !== undefined && cause !== err
    ? foreignKeyViolationConstraint(cause)
    : null;
}

// createComment validates the parent exists+visible, then awaits moderation
// (a network call, seconds) before inserting (design D7 steps 5 vs 7) — a
// parent hard-deleted in that window throws this FK violation instead of
// failing the earlier check. Exact constraint match (migration
// 0010_reflective_elektra.sql: comments_parent_id_comments_id_fk) so an
// unrelated FK on the same insert (post_id/author_id) is never misread as
// the parent race.
export function isParentDeletedRace(err: unknown): boolean {
  return (
    foreignKeyViolationConstraint(err) === "comments_parent_id_comments_id_fk"
  );
}

export async function insertComment(input: {
  postId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  status: CommentStatus;
  modVerdict: ModVerdictRecord;
}): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db
    .insert(comments)
    .values({
      postId: input.postId,
      parentId: input.parentId,
      authorId: input.authorId,
      body: input.body,
      status: input.status,
      modVerdict: input.modVerdict,
    })
    .returning({ id: comments.id, createdAt: comments.createdAt });
  return row!;
}

// authorId is nullable (ACCT-1 anonymization): a null never equals a real
// session id, so the ownership check in the edit service naturally denies
// editing an anonymized comment rather than needing a special case.
export type OwnedCommentForEdit = {
  id: string;
  authorId: string | null;
  postId: string;
  parentId: string | null;
  status: CommentStatus;
  createdAt: Date;
  editedAt: Date | null;
};

export async function loadCommentForEdit(
  id: string,
): Promise<OwnedCommentForEdit | undefined> {
  const [row] = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      postId: comments.postId,
      parentId: comments.parentId,
      status: comments.status,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
    })
    .from(comments)
    .where(eq(comments.id, id))
    .limit(1);
  return row;
}

// Applies a re-moderated edit (body + new status + new verdict + editedAt)
// in ONE update — moderation would otherwise be trivially bypassable by
// editing (design D7 "Edit"). Returns the stamped editedAt for the
// CommentNode the caller returns on the `visible` arm.
export async function applyCommentEdit(
  id: string,
  body: string,
  status: CommentStatus,
  modVerdict: ModVerdictRecord,
): Promise<Date> {
  const [row] = await db
    .update(comments)
    .set({ body, status, modVerdict, editedAt: new Date() })
    .where(eq(comments.id, id))
    .returning({ editedAt: comments.editedAt });
  return row!.editedAt!;
}

// authorId is nullable (ACCT-1 anonymization) — same reasoning as
// OwnedCommentForEdit above; a null authorId can never match the acting
// user, so the ownership check falls through to the ManageAnyComment check.
export type CommentForDelete = {
  id: string;
  authorId: string | null;
  postId: string;
};

export async function loadCommentForDelete(
  id: string,
): Promise<CommentForDelete | undefined> {
  const [row] = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      postId: comments.postId,
    })
    .from(comments)
    .where(eq(comments.id, id))
    .limit(1);
  return row;
}

export async function commentHasChildren(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.parentId, id))
    .limit(1);
  return row !== undefined;
}

// Soft delete (design D8): body cleared for privacy — the placeholder never
// needs it (buildCommentTree redacts non-visible bodies anyway, but clearing
// at rest means a `deleted` row never carries content at all).
export async function softDeleteComment(id: string): Promise<void> {
  await db
    .update(comments)
    .set({ status: CommentStatus.Deleted, body: "" })
    .where(eq(comments.id, id));
}

// Self-service account deletion (ACCT-1): ONE uniform update over every
// comment the deleting user authored, regardless of current status — the
// existing placeholder/prune rule in tree.ts (ADR-0020) already renders a
// `deleted` row with no author identically whether it got there via
// softDeleteComment or here, so there's no per-status branching to do.
// Takes `tx` because it's composed inside the caller's
// withLockedUserMutation transaction (src/lib/users/service.ts) — it must
// commit or roll back atomically with the user-row delete/guard checks.
export async function anonymizeCommentsForUser(
  tx: Tx,
  userId: string,
): Promise<void> {
  await tx
    .update(comments)
    .set({
      authorId: null,
      status: CommentStatus.Deleted,
      body: "",
      modVerdict: null,
    })
    .where(eq(comments.authorId, userId));
}

// Self-join alias for the NOT EXISTS guard below — deleting FROM comments
// while correlating a subquery against comments needs a second reference to
// the same table.
const childComments = alias(comments, "child_comments");

// Race-safe hard delete (design D8): the NOT EXISTS guard is evaluated by
// Postgres atomically with the DELETE, so a child inserted between the
// caller's earlier childless check and this call still blocks the delete
// (parent_id FK backstops it too). Returns whether the row was removed.
export async function hardDeleteCommentIfChildless(
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(comments)
    .where(
      and(
        eq(comments.id, id),
        notExists(
          db
            .select({ id: childComments.id })
            .from(childComments)
            .where(eq(childComments.parentId, comments.id)),
        ),
      ),
    )
    .returning({ id: comments.id });
  return deleted.length > 0;
}

// One query, ALL statuses (design D5): buildCommentTree needs the full set
// (including held/rejected/deleted) to correctly redact-and-prune, not just
// visible+deleted. Ordered so buildCommentTree's own sort is just a
// stability formality, not load-bearing.
//
// likeCount/likedByMe (design §5.4, LIKE-3) ride along as correlated scalar
// subqueries rather than a second query per row (no N+1) — `::int` keeps the
// count a native pg int4 (parsed as a JS number), not the string node-pg
// would hand back for an int8/bigint. viewerId null (signed-out reader)
// skips the EXISTS entirely via a `false` literal rather than parameterizing
// a viewer that can never match.
//
// leftJoin (not innerJoin): an anonymized row (ACCT-1, author_id NULL) has
// no user to inner-join against — dropping it here would silently orphan
// any of its still-visible children too (buildCommentTree needs the parent
// row present to attach them). The row's redacted (body/author already
// stripped at rest) so nothing leaks; authorName/authorImage are nullable to
// match.
export async function loadCommentRowsForPost(
  postId: string,
  viewerId: string | null,
): Promise<CommentRow[]> {
  const likedByMe = viewerId
    ? sql<boolean>`exists (select 1 from ${commentLikes} where ${commentLikes.commentId} = ${comments.id} and ${commentLikes.userId} = ${viewerId})`
    : sql<boolean>`false`;

  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorId: comments.authorId,
      authorName: user.name,
      authorImage: user.image,
      body: comments.body,
      status: comments.status,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      likeCount: sql<number>`(select count(*)::int from ${commentLikes} where ${commentLikes.commentId} = ${comments.id})`,
      likedByMe,
    })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(eq(comments.postId, postId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

// Admin lock toggle (design D10) — comment-feature state stored on posts
// (ADR-0004). Returns whether a row was updated (false = post not found).
export async function setPostCommentsLockedColumn(
  postId: string,
  locked: boolean,
): Promise<boolean> {
  const updated = await db
    .update(posts)
    .set({
      commentsLocked: locked,
      // Moderation state is outside the editorial snapshot. Preserve the
      // current token atomically, without replacing it from an earlier read.
      editVersion: sql`${posts.editVersion}`,
    })
    .where(eq(posts.id, postId))
    .returning({ id: posts.id });
  return updated.length > 0;
}

// Moderation log row (design D9): held/rejected comments joined with post
// title/slug + author name for the admin browse screen.
export type ModerationLogRow = {
  id: string;
  body: string;
  status: CommentStatus;
  modVerdict: ModVerdictRecord | null;
  createdAt: Date;
  post: { slug: string; title: string };
  // Names aren't unique — the admin needs the email to match a comment to a
  // specific account (feedback item 4). Admin-only screen, so showing PII
  // here is fine.
  // bannedAt surfaces auto-bans (CMT-10) right where the rejections are
  // reviewed, so the admin doesn't have to cross-reference /admin/users.
  author: { name: string; email: string; bannedAt: Date | null };
};

export const MODERATION_LOG_PAGE_SIZE = 25;

export async function listModerationLogRows(params: {
  status: typeof CommentStatus.Held | typeof CommentStatus.Rejected;
  limit: number;
  offset: number;
}): Promise<{ rows: ModerationLogRow[]; hasMore: boolean }> {
  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      status: comments.status,
      modVerdict: comments.modVerdict,
      createdAt: comments.createdAt,
      post: { slug: posts.slug, title: posts.title },
      author: { name: user.name, email: user.email, bannedAt: user.bannedAt },
    })
    .from(comments)
    .innerJoin(posts, eq(posts.id, comments.postId))
    // innerJoin is safe here (unlike loadCommentRowsForPost's leftJoin):
    // this query is scoped to held/rejected, and account-deletion
    // anonymization (ACCT-1) always sets author_id NULL together with
    // status='deleted' — a NULL-author row can never match this filter.
    .innerJoin(user, eq(user.id, comments.authorId))
    .where(eq(comments.status, params.status))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(params.limit + 1)
    .offset(params.offset);

  const hasMore = rows.length > params.limit;
  return { rows: hasMore ? rows.slice(0, params.limit) : rows, hasMore };
}

// Compare-and-swap status transition shared by approveHeldComment
// (held -> visible) and restoreRejectedComment (rejected -> visible) — no
// row matched (already resolved by someone else, or a bad id) is a conflict,
// not a silent no-op (design D9).
export async function casCommentStatus(
  id: string,
  fromStatus: CommentStatus,
  toStatus: CommentStatus,
): Promise<boolean> {
  const updated = await db
    .update(comments)
    .set({ status: toStatus })
    .where(and(eq(comments.id, id), eq(comments.status, fromStatus)))
    .returning({ id: comments.id });
  return updated.length > 0;
}
