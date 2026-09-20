import "server-only";

import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  categories,
  postDrafts,
  posts,
  postTags,
  tags,
  user,
} from "@/db/schema";
import {
  Action,
  canPerformAction,
  rolesWithAction,
} from "@/lib/auth/permissions";
import { draftFromJoinRow, draftJoinColumns } from "@/lib/posts/data";
import { tagToSlug } from "@/lib/posts/input";
import { PostStatus, usesDraftBuffer } from "@/lib/posts/status";
import { postTagsAgg } from "@/lib/posts/posts";
import { escapeLike } from "@/lib/shared/sql-like";

// Editor-facing shape (ADM-2): everything the post editor form reads/writes.
// Thumbnail/banner/video are deliberately absent from the editor UI (ADM-6),
// but the row still carries them — omitted here since nothing reads them yet.
export type EditablePost = {
  id: string;
  editVersion: string;
  title: string;
  slug: string;
  bodyMd: string;
  status: PostStatus;
  // Exposed only for UI gating (ADM-4/ACCT-1's author-hard-delete affordance)
  // — the delete server action re-checks ownership itself, so this is a
  // visibility hint, not a security boundary.
  authorId: string;
  categoryId: number;
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
  // Scheduling timestamps (ADM-5); null until a publish/archive is scheduled.
  publishAt: Date | null;
  archiveAt: Date | null;
  tags: string[];
  // Draft-of-published (ADR-0011): true when a public post has staged edits.
  // When true, the content fields above are the STAGED snapshot, not the live
  // post — the editor edits (and autosaves to) the pending copy.
  hasPendingChanges: boolean;
  draftUpdatedAt: Date | null;
  // Comment-lock state (CMT-8, FR-4.4): a live post column, not staged by
  // ADR-0011's draft buffer — locking is a moderation action independent of
  // content edits, so it applies immediately regardless of pending changes.
  commentsLocked: boolean;
};

// Loads a single post for editing. Authors are scoped to their own rows;
// admins are unscoped (design §5.7). Returns null both when the post doesn't
// exist and when an author isn't its owner — collapsing "not found" and "not
// yours" into the same response avoids an existence oracle.
export async function getEditablePost(
  id: string,
  // `role` stays loose (string) because Better Auth's inferred session types
  // it as string, not the pg enum — same as canPerformAction's user shape.
  user: { id: string; role?: string | null },
): Promise<EditablePost | null> {
  const rows = await db
    .select({
      id: posts.id,
      editVersion: posts.editVersion,
      title: posts.title,
      slug: posts.slug,
      bodyMd: posts.bodyMd,
      status: posts.status,
      categoryId: posts.categoryId,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
      authorId: posts.authorId,
      commentsLocked: posts.commentsLocked,
      tagName: tags.name,
      ...draftJoinColumns,
    })
    .from(posts)
    .leftJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .leftJoin(postTags, eq(postTags.postId, posts.id))
    .leftJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(posts.id, id))
    .orderBy(asc(tags.name));

  const [first] = rows;
  if (!first) return null;
  if (
    !canPerformAction(user, Action.ManageAnyPost) &&
    first.authorId !== user.id
  ) {
    return null;
  }

  // On a public post, edits are staged (ADR-0011): show the pending snapshot so
  // the author edits their in-progress copy, not the live content. On any other
  // status the buffer is ignored (drafts/archived edit live).
  const draft = usesDraftBuffer(first.status) ? draftFromJoinRow(first) : null;
  const liveTags = rows.flatMap((row) => (row.tagName ? [row.tagName] : []));

  return {
    id: first.id,
    editVersion: first.editVersion,
    title: draft?.title ?? first.title,
    slug: draft?.slug ?? first.slug,
    bodyMd: draft?.bodyMd ?? first.bodyMd,
    status: first.status,
    authorId: first.authorId,
    categoryId: draft?.categoryId ?? first.categoryId,
    thumbnailUrl: draft?.thumbnailUrl ?? first.thumbnailUrl,
    // banner/video can legitimately be null in the snapshot — pick from the
    // snapshot when it exists, not via ?? (which would fall back to live null).
    bannerUrl: draft ? draft.bannerUrl : first.bannerUrl,
    videoUrl: draft ? draft.videoUrl : first.videoUrl,
    publishAt: first.publishAt,
    archiveAt: first.archiveAt,
    tags: draft ? draft.tags : liveTags,
    hasPendingChanges: draft !== null,
    draftUpdatedAt: draft ? first.draftUpdatedAt : null,
    commentsLocked: first.commentsLocked,
  };
}

// Full render shape for the ADM-7 preview — the same fields getVisiblePost-
// BySlug returns, but publishAt may be null (drafts) and status is exposed so
// the preview page can badge "not yet public".
export type PreviewPost = {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  status: PostStatus;
  thumbnailUrl: string;
  bannerUrl: string | null;
  videoUrl: string | null;
  publishAt: Date | null;
  archiveAt: Date | null;
  // Feeds PostArticle's showsUpdatedDate guard (POST-10) so the preview stays
  // pixel-identical to the public page.
  contentUpdatedAt: Date | null;
  category: { slug: string; name: string };
  author: { name: string; image: string | null };
  tags: { slug: string; name: string }[];
  // Draft-of-published (ADR-0011): true when the fields above are a public
  // post's STAGED snapshot (what "Publish changes" will make live), so the
  // preview shows pending edits rather than the current live content.
  hasPendingChanges: boolean;
};

// Loads a post by id for private preview, BYPASSING visiblePostsWhere() so a
// draft/scheduled/archived post can be viewed exactly as it will publish
// (design §5.7). Ownership-scoped like getEditablePost: authors see only their
// own, admin sees all; returns null for missing OR not-owned (no oracle).
export async function getPostForPreview(
  id: string,
  user_: { id: string; role?: string | null },
): Promise<PreviewPost | null> {
  const rows = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      bodyMd: posts.bodyMd,
      status: posts.status,
      thumbnailUrl: posts.thumbnailUrl,
      bannerUrl: posts.bannerUrl,
      videoUrl: posts.videoUrl,
      publishAt: posts.publishAt,
      archiveAt: posts.archiveAt,
      contentUpdatedAt: posts.contentUpdatedAt,
      authorId: posts.authorId,
      categoryId: posts.categoryId,
      category: { slug: categories.slug, name: categories.name },
      author: { name: user.name, image: user.image },
      tags: postTagsAgg,
      ...draftJoinColumns,
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .innerJoin(user, eq(posts.authorId, user.id))
    .leftJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .leftJoin(postTags, eq(postTags.postId, posts.id))
    .leftJoin(tags, eq(tags.id, postTags.tagId))
    .where(eq(posts.id, id))
    .groupBy(posts.id, categories.id, user.id, postDrafts.postId)
    .limit(1);

  const [row] = rows;
  if (!row) return null;
  if (
    !canPerformAction(user_, Action.ManageAnyPost) &&
    row.authorId !== user_.id
  ) {
    return null;
  }

  // On a public post, preview the STAGED snapshot (what will go live), not the
  // current live content (ADR-0011). Category and tags come from the live join
  // by default; when previewing a snapshot, resolve the staged category name
  // and derive tag slugs so the preview reflects the pending edit faithfully.
  const draft = usesDraftBuffer(row.status) ? draftFromJoinRow(row) : null;

  let category = row.category;
  let previewTags = row.tags;
  if (draft) {
    if (draft.categoryId !== row.categoryId) {
      const [staged] = await db
        .select({ slug: categories.slug, name: categories.name })
        .from(categories)
        .where(eq(categories.id, draft.categoryId))
        .limit(1);
      if (staged) category = staged;
    }
    const seen = new Set<string>();
    previewTags = [];
    for (const name of draft.tags) {
      const slug = tagToSlug(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      previewTags.push({ slug, name });
    }
  }

  // authorId is loaded only for the ownership check above, not part of the
  // render shape.
  return {
    id: row.id,
    slug: draft?.slug ?? row.slug,
    title: draft?.title ?? row.title,
    bodyMd: draft?.bodyMd ?? row.bodyMd,
    status: row.status,
    thumbnailUrl: draft?.thumbnailUrl ?? row.thumbnailUrl,
    bannerUrl: draft ? draft.bannerUrl : row.bannerUrl,
    videoUrl: draft ? draft.videoUrl : row.videoUrl,
    publishAt: row.publishAt,
    archiveAt: row.archiveAt,
    contentUpdatedAt: row.contentUpdatedAt,
    category,
    author: row.author,
    tags: previewTags,
    hasPendingChanges: draft !== null,
  };
}

// Dashboard list row (ADM-8, FR-7.1). Only the columns the list renders —
// publish_at still drives the "published" sort via ORDER BY without being
// selected.
export type AdminPostRow = {
  id: string;
  title: string;
  status: PostStatus;
  updatedAt: Date;
  category: { name: string };
  author: { name: string };
};

export const ADMIN_POST_SORTS = ["updated", "published"] as const;
export type AdminPostSort = (typeof ADMIN_POST_SORTS)[number];
const [, SORT_PUBLISHED] = ADMIN_POST_SORTS;

export const ADMIN_POSTS_PAGE_SIZE = 25;

// Filtered/sorted post list for the admin dashboard. SECURITY: authors are
// hard-scoped to their own rows here (§5.7) — a non-admin's `authorId` filter
// is ignored, never widening their view. Fetches one extra row to report
// hasMore without a separate count query.
export async function listAdminPosts(params: {
  user: { id: string; role?: string | null };
  status?: PostStatus;
  categoryId?: number;
  authorId?: string;
  q?: string;
  sort?: AdminPostSort;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AdminPostRow[]; hasMore: boolean }> {
  const limit = Math.min(
    Math.max(params.limit ?? ADMIN_POSTS_PAGE_SIZE, 1),
    100,
  );
  const offset = Math.max(params.offset ?? 0, 0);

  const conditions: SQL[] = [];
  if (!canPerformAction(params.user, Action.ManageAnyPost)) {
    // Non-admins see only their own posts, regardless of any authorId filter.
    conditions.push(eq(posts.authorId, params.user.id));
  } else if (params.authorId) {
    conditions.push(eq(posts.authorId, params.authorId));
  }
  if (params.status) conditions.push(eq(posts.status, params.status));
  if (params.categoryId) {
    conditions.push(eq(posts.categoryId, params.categoryId));
  }
  // Free-text title search (admin dashboard is uncached, so a simple ILIKE
  // contains is fine — public search uses FTS, FR-3.1). Blank/whitespace is a
  // no-op filter.
  const q = params.q?.trim();
  if (q) conditions.push(ilike(posts.title, `%${escapeLike(q)}%`));

  // Drafts have a null publish_at — keep them last when sorting by publish
  // date. A secondary id sort keeps pagination stable across ties.
  const orderBy =
    params.sort === SORT_PUBLISHED
      ? [sql`${posts.publishAt} desc nulls last`, desc(posts.id)]
      : [desc(posts.updatedAt), desc(posts.id)];

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      status: posts.status,
      updatedAt: posts.updatedAt,
      category: { name: categories.name },
      author: { name: user.name },
    })
    .from(posts)
    .innerJoin(categories, eq(posts.categoryId, categories.id))
    .innerJoin(user, eq(posts.authorId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

// Staff users for the dashboard's author filter (admin only).
export async function listAuthorOptions(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.role, rolesWithAction(Action.AccessAdmin)))
    .orderBy(asc(user.name));
}
