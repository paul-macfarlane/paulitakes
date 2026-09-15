// Operator data layer: no app runtime/server-only import or credential output.
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agentCredentials } from "../../src/db/schema";

export async function insertCredential(
  db: NodePgDatabase,
  value: typeof agentCredentials.$inferInsert,
) {
  await db.insert(agentCredentials).values(value);
}
export async function revokeCredential(db: NodePgDatabase, id: string) {
  return db
    .update(agentCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(agentCredentials.id, id))
    .returning({ id: agentCredentials.id });
}
export async function listCredentials(db: NodePgDatabase) {
  return db
    .select({
      id: agentCredentials.id,
      label: agentCredentials.label,
      scopes: agentCredentials.scopes,
      expiresAt: agentCredentials.expiresAt,
      revokedAt: agentCredentials.revokedAt,
    })
    .from(agentCredentials)
    .orderBy(agentCredentials.createdAt);
}
