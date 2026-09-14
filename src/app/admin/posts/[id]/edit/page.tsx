import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReviewNavigation } from "@/app/admin/posts/[id]/edit/_components/review-navigation";
import { PostEditorSection } from "@/app/admin/posts/_components/post-editor-section";
import { CommentLockToggle } from "@/app/admin/posts/[id]/edit/_components/comment-lock-toggle";
import { PostDeleteControls } from "@/app/admin/posts/[id]/edit/_components/post-delete-controls";
import { PostPendingControls } from "@/app/admin/posts/[id]/edit/_components/post-pending-controls";
import { PostScheduleControls } from "@/app/admin/posts/[id]/edit/_components/post-schedule-controls";
import { PostStatusControls } from "@/app/admin/posts/[id]/edit/_components/post-status-controls";
import { getEditablePost } from "@/lib/posts/admin";
import { listActiveCategories } from "@/lib/categories/data";
import { requirePostIdParam } from "@/lib/admin/route-params";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { PostStatus } from "@/lib/posts/status";

export const metadata: Metadata = {
  title: "Edit post",
  robots: { index: false, follow: false },
};

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStaff(`/admin/posts/${id}/edit`);
  const postId = requirePostIdParam(id);

  const [post, categories] = await Promise.all([
    getEditablePost(postId, session.user),
    listActiveCategories(),
  ]);
  if (!post) notFound();

  return (
    <>
      <Link
        href="/admin"
        className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Posts
      </Link>
      <PostEditorSection
        heading="Edit post"
        previewHref={`/admin/preview/${post.id}`}
        categories={categories}
        initialPost={post}
      >
        <div className="mb-6 flex flex-col gap-4">
          <ReviewNavigation postId={post.id} />
          {post.hasPendingChanges ? (
            <PostPendingControls
              postId={post.id}
              draftUpdatedAt={post.draftUpdatedAt}
            />
          ) : null}
          <PostStatusControls
            postId={post.id}
            status={post.status}
            pendingChanges={post.hasPendingChanges}
          />
          <PostScheduleControls
            postId={post.id}
            status={post.status}
            publishAt={post.publishAt}
            archiveAt={post.archiveAt}
            pendingChanges={post.hasPendingChanges}
          />
          {canPerformAction(session.user, Action.ManageAnyComment) ? (
            <CommentLockToggle postId={post.id} locked={post.commentsLocked} />
          ) : null}
          {canPerformAction(session.user, Action.ManageAnyPost) ||
          (post.authorId === session.user.id &&
            (post.status === PostStatus.Draft ||
              post.status === PostStatus.Scheduled)) ? (
            // Visibility hint only — deletePostService (and, underneath it,
            // deleteOwnNeverPublicPost's guarded DELETE) enforces the exact
            // never-public/comment-free predicate server-side, so showing
            // this button on a post that fails that predicate just surfaces
            // AUTHOR_DELETE_REFUSED_ERROR on click rather than being a hole.
            <div className="border-t pt-4">
              <PostDeleteControls postId={post.id} postTitle={post.title} />
            </div>
          ) : null}
        </div>
      </PostEditorSection>
    </>
  );
}
