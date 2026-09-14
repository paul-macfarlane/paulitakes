import "server-only";

// Business logic for createPost/updatePost/deletePost (ADM-2/ADM-3): slug
// derivation and collision retries, the stage-vs-direct-edit decision
// (ADR-0011), and all cache invalidation for these three actions. DB access
// lives in src/lib/posts/data.ts; auth/ownership guarding happens in the
// thin action (src/actions/posts/crud.ts) before these are called.

import { revalidateTag } from "next/cache";

import type { StaffSession } from "@/lib/auth/guards";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import { isRenderableImageSrc } from "@/lib/content/image-src";
import {
  categoryExists,
  checkEditVersion,
  clearStagedDraft,
  deleteOwnNeverPublicPost,
  deletePostRow,
  findSlugClash,
  insertPost,
  isPostSlugCollision,
  loadPostForUpdate,
  loadPostTagNames,
  loadStageDraftBase,
  writePostColumns,
  writeStagedDraft,
  type PostColumnUpdate,
} from "@/lib/posts/data";
import {
  postDraftSchema,
  slugifyTitle,
  tagToSlug,
  type PostDraft,
  type PostInput,
  type PostUpdate,
  type SavedPost,
} from "@/lib/posts/input";
import { isPubliclyVisible } from "@/lib/posts/status";
import {
  CONFLICT_RESULT,
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";
import { IMMEDIATE } from "@/lib/shared/cache";

export async function createPostService(
  data: PostInput,
  authorId: string,
): Promise<ActionResult<SavedPost>> {
  try {
    if (!(await categoryExists(data.categoryId))) {
      return { ok: false, error: "Unknown category." };
    }

    // An explicit slug is a deliberate author choice — same rule as
    // updatePost — so it's only the title-derived case that gets a
    // disambiguation retry below.
    const derivedSlug = data.slug === undefined;
    const slug = data.slug ?? slugifyTitle(data.title);

    try {
      return { ok: true, data: await insertPost(slug, data, authorId) };
    } catch (err) {
      if (!isPostSlugCollision(err)) throw err;

      if (!derivedSlug) {
        return { ok: false, error: "That slug is taken." };
      }

      // Retry once with a disambiguated slug — covers the common case of two
      // drafts sharing a title. Truncate the base to 73 chars (stripping any
      // trailing hyphen left by the cut) so the appended "-" + 6 hex chars
      // never pushes the result past the 80-char cap postUpdateSchema
      // enforces on every later editor round-trip. A second collision
      // (vanishingly unlikely) surfaces as a normal, actionable error
      // instead of retrying forever.
      const retryBase = slug.slice(0, 73).replace(/-+$/, "");
      const retrySlug = `${retryBase}-${crypto.randomUUID().slice(0, 6)}`;
      try {
        return {
          ok: true,
          data: await insertPost(retrySlug, data, authorId),
        };
      } catch (retryErr) {
        if (isPostSlugCollision(retryErr)) {
          return { ok: false, error: "That slug is taken." };
        }
        throw retryErr;
      }
    }
  } catch (err) {
    console.error("createPost failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Tag sets compared the way setPostTags dedupes them — by derived slug, order-
// and duplicate-insensitive — so "reverting" tags to the live set counts as no
// change even if retyped in a different order.
function sameTagSet(a: string[], b: string[]): boolean {
  const norm = (t: string[]) =>
    [...new Set(t.map(tagToSlug).filter(Boolean))].sort();
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Whether a staged snapshot is content-identical to the live post — used to
// detect an edit that reverts back to live, so the buffer can be cleared rather
// than left non-null (which would keep the post "pending" and lock its
// lifecycle controls).
function draftContentEquals(a: PostDraft, b: PostDraft): boolean {
  return (
    a.title === b.title &&
    a.slug === b.slug &&
    a.bodyMd === b.bodyMd &&
    a.categoryId === b.categoryId &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.bannerUrl === b.bannerUrl &&
    a.videoUrl === b.videoUrl &&
    sameTagSet(a.tags, b.tags)
  );
}

// Stages an edit to a currently-public post into its post_drafts row instead
// of the live columns (ADR-0011). Merges the partial autosave diff onto the
// current pending snapshot — or, on the first staged edit, onto the live
// content — so the buffer always holds a COMPLETE, publishable snapshot that
// publishPostChanges can promote wholesale. Never revalidates public caches:
// the live post is unchanged until the author publishes.
async function stageDraftEdit(
  id: string,
  data: PostUpdate,
  expectedVersion: string,
): Promise<ActionResult<SavedPost>> {
  const row = await loadStageDraftBase(id);
  if (!row) return { ok: false, error: "Post not found." };

  // Live content — the merge base on the first staged edit, and always the
  // yardstick for the "reverted to live" no-op check below.
  const live: PostDraft = {
    title: row.title,
    slug: row.slug,
    bodyMd: row.bodyMd,
    categoryId: row.categoryId,
    thumbnailUrl: row.thumbnailUrl,
    bannerUrl: row.bannerUrl,
    videoUrl: row.videoUrl,
    tags: await loadPostTagNames(id),
  };
  const base: PostDraft = row.draft ?? live;

  // Absent diff keys mean "leave the staged value unchanged" (postUpdateSchema
  // contract), so only overlay keys the author actually sent.
  const merged: PostDraft = {
    ...base,
    ...(data.title !== undefined && { title: data.title }),
    ...(data.slug !== undefined && { slug: data.slug }),
    ...(data.bodyMd !== undefined && { bodyMd: data.bodyMd }),
    ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
    ...(data.thumbnailUrl !== undefined && { thumbnailUrl: data.thumbnailUrl }),
    ...(data.bannerUrl !== undefined && { bannerUrl: data.bannerUrl }),
    ...(data.videoUrl !== undefined && { videoUrl: data.videoUrl }),
    ...(data.tags !== undefined && { tags: data.tags }),
  };

  // The staged snapshot must stay publishable — a public post keeps a real
  // thumbnail (same invariant the live-write path enforces for drafts going
  // public). Surface the specific message before the generic schema parse.
  if (!isRenderableImageSrc(merged.thumbnailUrl)) {
    return {
      ok: false,
      error: "A published or scheduled post must keep its thumbnail.",
    };
  }
  const validated = postDraftSchema.safeParse(merged);
  if (!validated.success) {
    return { ok: false, error: validated.error.issues[0]!.message };
  }
  const snapshot = validated.data;

  // Immediate slug-collision feedback (parity with the live-write path): the
  // staged slug lives in post_drafts with no unique constraint, so a clash
  // would otherwise stay hidden until publish. Only check a slug that actually
  // differs from this post's live slug.
  if (snapshot.slug !== row.slug) {
    if (await findSlugClash(snapshot.slug, id)) {
      return { ok: false, error: "That slug is taken." };
    }
  }

  // Reverting edits back to the live content leaves nothing to stage — clear
  // the buffer so the post isn't stuck showing "pending changes" with its
  // status/schedule controls locked.
  if (draftContentEquals(snapshot, live)) {
    const cleared = await clearStagedDraft(id, expectedVersion);
    if (!cleared) return CONFLICT_RESULT;
    return {
      ok: true,
      data: { id, slug: snapshot.slug, editVersion: cleared },
    };
  }

  const updated = await writeStagedDraft(id, expectedVersion, snapshot);
  if (!updated) {
    return CONFLICT_RESULT;
  }

  return { ok: true, data: { id, slug: snapshot.slug, editVersion: updated } };
}

export async function updatePostService(
  id: string,
  data: PostUpdate,
  session: StaffSession,
  expectedVersion: string,
): Promise<ActionResult<SavedPost>> {
  try {
    // Two independent reads on the editor's hottest path — issue them
    // concurrently; error precedence (not found -> ownership -> category)
    // is preserved by the check order below.
    const [existing, categoryOk] = await Promise.all([
      loadPostForUpdate(id),
      data.categoryId === undefined ? true : categoryExists(data.categoryId),
    ]);

    if (!existing) {
      return { ok: false, error: "Post not found." };
    }

    // Authors are scoped to their own rows; admins are unscoped (§5.7).
    if (
      !canPerformAction(session.user, Action.ManageAnyPost) &&
      existing.authorId !== session.user.id
    ) {
      return { ok: false, error: NOT_AUTHORIZED_ERROR };
    }

    if (existing.editVersion !== expectedVersion) {
      return CONFLICT_RESULT;
    }

    if (!categoryOk) {
      return { ok: false, error: "Unknown category." };
    }

    if (Object.keys(data).length === 0) {
      const unchanged = await checkEditVersion(id, expectedVersion);
      return unchanged ? { ok: true, data: unchanged } : CONFLICT_RESULT;
    }

    // A post that is publicly visible RIGHT NOW stages edits into its
    // post_drafts row instead of writing live, so the public keeps seeing
    // the current content until the author promotes the pending changes
    // (ADR-0011). Routing on actual visibility, not just status, matters at
    // the edges: a scheduled post whose publish_at is still in the future
    // isn't public yet, so its edits write live and are simply what goes out
    // at publish time (staging them would strand the edits, since nothing
    // promotes the buffer when the scheduled time arrives). A scheduled post
    // already past its publish_at is live and does stage. Draft/archived
    // posts aren't public — write through.
    if (isPubliclyVisible(existing)) {
      return await stageDraftEdit(id, data, expectedVersion);
    }

    // Below here the post is not publicly visible (draft, archived, or a
    // scheduled post awaiting its publish_at). `status` isn't a field on
    // postUpdateSchema, so this action never moves a post between statuses —
    // transitions are ADM-4's job.
    // clearingThumbnail still feeds the write-time CAS guard, which defends the
    // read->write window against a concurrent publish that would otherwise slip
    // a "" thumbnail onto a post that just went public.
    const clearingThumbnail =
      data.thumbnailUrl !== undefined &&
      !isRenderableImageSrc(data.thumbnailUrl);

    const nextSlug = data.slug ?? existing.slug;

    const columnUpdates: PostColumnUpdate = {};
    if (data.title !== undefined) columnUpdates.title = data.title;
    if (data.slug !== undefined) columnUpdates.slug = data.slug;
    if (data.bodyMd !== undefined) columnUpdates.bodyMd = data.bodyMd;
    if (data.categoryId !== undefined) {
      columnUpdates.categoryId = data.categoryId;
    }
    if (data.thumbnailUrl !== undefined) {
      columnUpdates.thumbnailUrl = data.thumbnailUrl;
    }
    if (data.bannerUrl !== undefined) {
      columnUpdates.bannerUrl = data.bannerUrl;
    }
    if (data.videoUrl !== undefined) {
      columnUpdates.videoUrl = data.videoUrl;
    }

    const written = await writePostColumns(id, columnUpdates, {
      expectedVersion,
      guardThumbnailInvariant: clearingThumbnail,
      tags: data.tags,
    });
    if (!written.ok) {
      if (written.reason === "conflict") {
        return CONFLICT_RESULT;
      }
      if (written.reason === "thumbnail-invariant") {
        return {
          ok: false,
          error: "A published or scheduled post must keep its thumbnail.",
        };
      }
      return { ok: false, error: "That slug is taken." };
    }

    if (Object.keys(columnUpdates).length === 0 && data.tags === undefined) {
      return {
        ok: true,
        data: { id, slug: nextSlug, editVersion: written.editVersion },
      };
    }

    // Cheap and correct even for drafts: revalidating a tag nobody has
    // cached is a no-op. Call after the transaction commits.
    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${nextSlug}`, IMMEDIATE);
    if (nextSlug !== existing.slug) {
      revalidateTag(`post:${existing.slug}`, IMMEDIATE);
    }

    return {
      ok: true,
      data: { id, slug: nextSlug, editVersion: written.editVersion },
    };
  } catch (err) {
    console.error("updatePost failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// An author's delete is scoped to their own never-public, comment-free
// posts (deleteOwnNeverPublicPost enforces the exact predicate) — the same
// message covers every way that predicate can fail (not theirs, already
// public/was-public, or has a comment) since the DB gives back only
// "matched" or "didn't", not which guard tripped.
export const AUTHOR_DELETE_REFUSED_ERROR =
  "You can only delete your own drafts or scheduled posts, and only before anyone has commented. Ask an admin otherwise.";

export async function deletePostService(
  session: StaffSession,
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    // ManageAnyPost (admin) hard-deletes any post unconditionally; everyone
    // else goes through the narrower own-never-public-post path (§5.7's
    // ownership bypass idiom).
    const deleted = canPerformAction(session.user, Action.ManageAnyPost)
      ? await deletePostRow(id)
      : await deleteOwnNeverPublicPost(id, session.user.id);

    if (!deleted) {
      return canPerformAction(session.user, Action.ManageAnyPost)
        ? { ok: false, error: "Post not found." }
        : { ok: false, error: AUTHOR_DELETE_REFUSED_ERROR };
    }

    // Revalidated on every success path, including the never-cached
    // author-owned deletes: harmless (revalidating a tag nobody cached is a
    // no-op) — belt-and-braces, not load-bearing. A published->draft revert
    // already busts post:{slug} at the point of that transition
    // (lifecycle.ts), so a deleted never-public post's tag was never left
    // stale by the time it gets here; this call is just cheap insurance.
    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${deleted.slug}`, IMMEDIATE);

    return { ok: true, data: { id: deleted.id } };
  } catch (err) {
    console.error("deletePost failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
