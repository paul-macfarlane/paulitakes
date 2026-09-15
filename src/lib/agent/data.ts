import "server-only";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentApiState,
  agentReceipts,
  categories,
  posts,
  postDrafts,
} from "@/db/schema";
import { PUBLIC_STATUSES } from "@/lib/posts/status";
import type { Tx } from "@/lib/posts/data";
import { AgentQuota, AGENT_PRINCIPAL } from "./contract";

export function agentTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(work);
}
export async function lockAgentState(tx: Tx) {
  await tx
    .insert(agentApiState)
    .values({ id: AGENT_PRINCIPAL.id })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(agentApiState)
    .where(eq(agentApiState.id, AGENT_PRINCIPAL.id))
    .for("update");
  return row!;
}
export async function writeQuota(
  tx: Tx,
  id: string,
  quota: AgentQuota,
  window: Date,
  count: number,
) {
  await tx
    .update(agentApiState)
    .set(
      quota === AgentQuota.Read
        ? { readWindow: window, readCount: count }
        : { submitWindow: window, submitCount: count },
    )
    .where(eq(agentApiState.id, id));
}
export async function findReceipt(tx: Tx, principalId: string, key: string) {
  const [row] = await tx
    .select()
    .from(agentReceipts)
    .where(
      and(
        eq(agentReceipts.principalId, principalId),
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
