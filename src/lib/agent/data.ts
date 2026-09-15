import "server-only";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentCredentials,
  agentReceipts,
  categories,
  posts,
  postDrafts,
} from "@/db/schema";
import { PUBLIC_STATUSES } from "@/lib/posts/status";
import type { Tx } from "@/lib/posts/data";
import { AgentScope } from "./contract";

export type Credential = typeof agentCredentials.$inferSelect;
export function agentTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(work);
}
export async function lockCredential(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(agentCredentials)
    .where(eq(agentCredentials.id, id))
    .for("update");
  return row;
}
export async function writeQuota(
  tx: Tx,
  id: string,
  scope: AgentScope,
  window: Date,
  count: number,
) {
  await tx
    .update(agentCredentials)
    .set(
      scope === AgentScope.Read
        ? { readWindow: window, readCount: count }
        : { submitWindow: window, submitCount: count },
    )
    .where(eq(agentCredentials.id, id));
}
export async function findReceipt(tx: Tx, credentialId: string, key: string) {
  const [row] = await tx
    .select()
    .from(agentReceipts)
    .where(
      and(
        eq(agentReceipts.credentialId, credentialId),
        eq(agentReceipts.key, key),
      ),
    );
  return row;
}
export async function insertReceipt(
  tx: Tx,
  receipt: typeof agentReceipts.$inferInsert,
) {
  await tx.insert(agentReceipts).values(receipt);
}
export async function listSources(tx: Tx, limit: number, after?: string) {
  // Agent content-read is an explicit site-wide grant, separate from public
  // visibility and human ownership. Include the editor's effective title.
  return tx
    .select({
      id: posts.id,
      title: sql<string>`case when ${inArray(posts.status, PUBLIC_STATUSES)} then coalesce(${postDrafts.title}, ${posts.title}) else ${posts.title} end`,
      status: posts.status,
      sourceVersion: posts.editVersion,
    })
    .from(posts)
    .leftJoin(postDrafts, eq(posts.id, postDrafts.postId))
    .where(after ? gt(posts.id, after) : undefined)
    .orderBy(asc(posts.id))
    .limit(limit + 1);
}
export async function reviewCategories(tx: Tx, currentId: number) {
  return tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(or(eq(categories.active, true), eq(categories.id, currentId)))
    .orderBy(sql`${categories.id} = ${currentId} desc`, asc(categories.id))
    .limit(101);
}
