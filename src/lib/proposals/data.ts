import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  editProposals,
  posts,
  postDrafts,
  postTags,
  tags,
} from "@/db/schema";
import {
  draftFromJoinRow,
  draftJoinColumns,
  lockPostRow,
  replaceStagedSnapshot,
  writePostColumnsInTransaction,
  type ExistingPostForUpdate,
  type Tx,
} from "@/lib/posts/data";
import { isPubliclyVisible, usesDraftBuffer } from "@/lib/posts/status";
import { ProposalStatus, type ProposalSnapshot } from "./input";

export type ProposalRow = typeof editProposals.$inferSelect;
export async function withLockedSource<T>(
  postId: string,
  work: (tx: Tx, post: ExistingPostForUpdate) => Promise<T>,
  transaction?: Tx,
): Promise<T | null> {
  const run = async (tx: Tx) => {
    const post = await lockPostRow(tx, postId);
    return post ? work(tx, post) : null;
  };
  return transaction ? run(transaction) : db.transaction(run);
}
export async function withLockedProposal<T>(
  id: string,
  work: (
    tx: Tx,
    post: ExistingPostForUpdate,
    proposal: ProposalRow,
  ) => Promise<T>,
): Promise<T | null> {
  const [reference] = await db
    .select({ postId: editProposals.postId })
    .from(editProposals)
    .where(eq(editProposals.id, id));
  if (!reference) return null;
  // Parent first, as with autosave/publish/discard. Re-read after acquiring it;
  // a concurrent rejection/supersession must be visible before deciding.
  return withLockedSource(reference.postId, async (tx, post) => {
    const [proposal] = await tx
      .select()
      .from(editProposals)
      .where(eq(editProposals.id, id));
    return proposal ? work(tx, post, proposal) : null;
  });
}
export async function loadSnapshots(
  tx: Tx,
  postId: string,
  post: ExistingPostForUpdate,
): Promise<{ live: ProposalSnapshot; effective: ProposalSnapshot }> {
  const [row] = await tx
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
    .leftJoin(postDrafts, eq(posts.id, postDrafts.postId))
    .where(eq(posts.id, postId));
  const names = await tx
    .select({ name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, postId))
    .orderBy(asc(tags.name));
  const live: ProposalSnapshot = {
    title: row!.title,
    slug: row!.slug,
    bodyMd: row!.bodyMd,
    categoryId: row!.categoryId,
    thumbnailUrl: row!.thumbnailUrl,
    bannerUrl: row!.bannerUrl,
    videoUrl: row!.videoUrl,
    tags: names.map((tag) => tag.name),
  };
  return {
    live,
    effective:
      (usesDraftBuffer(post.status) ? draftFromJoinRow(row!) : null) ?? live,
  };
}
export async function findOpenProposal(tx: Tx, postId: string) {
  const [proposal] = await tx
    .select()
    .from(editProposals)
    .where(
      and(
        eq(editProposals.postId, postId),
        eq(editProposals.status, ProposalStatus.Open),
      ),
    );
  return proposal;
}
export async function insertProposal(
  tx: Tx,
  values: typeof editProposals.$inferInsert,
): Promise<ProposalRow> {
  const [row] = await tx.insert(editProposals).values(values).returning();
  return row!;
}
export async function closeProposal(
  tx: Tx,
  id: string,
  decision: Pick<
    typeof editProposals.$inferInsert,
    | "status"
    | "decidedBy"
    | "acceptedChangeIds"
    | "rejectedChangeIds"
    | "appliedVersion"
  >,
): Promise<void> {
  await tx
    .update(editProposals)
    .set({ ...decision, decidedAt: new Date() })
    .where(eq(editProposals.id, id));
}
export async function snapshotReferencesValid(
  tx: Tx,
  postId: string,
  snapshot: ProposalSnapshot,
): Promise<string | null> {
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, snapshot.categoryId));
  if (!category) return "Unknown category.";
  const [clash] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, snapshot.slug), ne(posts.id, postId)));
  return clash ? "That slug is taken." : null;
}
export async function writeSelectedSnapshot(
  tx: Tx,
  postId: string,
  post: ExistingPostForUpdate,
  snapshot: ProposalSnapshot,
  staged: boolean,
  revertedToLive: boolean,
): Promise<string | null> {
  // Recheck wall-clock visibility immediately before writing; crossing a
  // schedule boundary is a conflict even without a status-normalizing cron.
  if (isPubliclyVisible(post) !== staged) return null;
  if (staged)
    return replaceStagedSnapshot(
      tx,
      postId,
      revertedToLive ? null : snapshot,
      post.editVersion,
    );
  const { tags: tagNames, ...columns } = snapshot;
  const result = await writePostColumnsInTransaction(tx, postId, columns, {
    expectedVersion: post.editVersion,
    tags: tagNames,
    guardThumbnailInvariant: !snapshot.thumbnailUrl,
  });
  if (!result.ok) return null;
  // A timed archive can hide a post before its status is normalized. Its
  // effective base may still be staged; consume that buffer with the full
  // selected snapshot so the editor cannot overlay obsolete content.
  await tx.delete(postDrafts).where(eq(postDrafts.postId, postId));
  return result.editVersion;
}
export async function listProposalSummaries(tx: Tx, postId: string, page = 1) {
  return tx
    .select({
      id: editProposals.id,
      status: editProposals.status,
      createdAt: editProposals.createdAt,
      agentLabel: editProposals.agentLabel,
      sourceVersion: editProposals.sourceVersion,
    })
    .from(editProposals)
    .where(eq(editProposals.postId, postId))
    .orderBy(desc(editProposals.createdAt), desc(editProposals.id))
    .limit(50)
    .offset((page - 1) * 50);
}
