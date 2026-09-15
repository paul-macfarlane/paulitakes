// Operator-only credential provisioning. Never run this through an agent API.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  insertCredential,
  revokeCredential,
  listCredentials,
} from "./agent-credentials/data";
import {
  agentIdSchema,
  createAgentCredential,
  credentialIssueSchema,
} from "../src/lib/agent/contract";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || !command) {
    console.log(
      "Usage: pnpm agent:credentials issue <label> <days:1-365> <content:read,proposals:create> | revoke <credential-uuid> | list",
    );
    return;
  }
  if (!["issue", "revoke", "list"].includes(command))
    throw new Error("Invalid command.");
  const issue =
    command === "issue"
      ? credentialIssueSchema.safeParse({
          label: args[0],
          days: args[1],
          scopes: args[2]?.split(","),
        })
      : null;
  const revoke = command === "revoke" ? agentIdSchema.safeParse(args[0]) : null;
  if (
    (issue && (!issue.success || args.length !== 3)) ||
    (revoke && (!revoke.success || args.length !== 1)) ||
    (command === "list" && args.length)
  )
    throw new Error("Invalid arguments. Use --help.");
  // Help and argument validation never load operator environment files.
  await import("dotenv/config");
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL must be provisioned by the operator.");
  const target = new URL(url);
  console.error(
    `Database target: ${target.hostname}:${target.port || "5432"}${target.pathname}`,
  );
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  try {
    if (issue?.success) {
      const credential = createAgentCredential();
      const expiresAt = new Date(Date.now() + issue.data.days * 86400000);
      await insertCredential(db, {
        id: credential.id,
        tokenHash: credential.tokenHash,
        label: issue.data.label,
        scopes: issue.data.scopes,
        expiresAt,
      });
      console.error(
        `Issued credential ${credential.id}; expires ${expiresAt.toISOString()}. Store the following token privately; it is shown only once. Scopes: ${issue.data.scopes.join(", ")}.`,
      );
      console.log(credential.token);
    } else if (revoke?.success) {
      const rows = await revokeCredential(db, revoke.data);
      if (!rows.length) throw new Error("Credential not found.");
      console.log(`Revoked ${rows[0]!.id}.`);
    } else {
      const rows = await listCredentials(db);
      console.table(rows);
    }
  } finally {
    await pool.end();
  }
}
// SQL errors may contain token hashes/connection details. Emit no exception.
main().catch(() => {
  console.error(
    "Credential command failed. Check arguments, database access and migration status. No credential was printed unless issuance succeeded.",
  );
  process.exitCode = 1;
});
