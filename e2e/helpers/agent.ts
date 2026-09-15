import { Pool } from "pg";
import {
  createAgentCredential,
  AgentScope,
} from "../../src/lib/agent/contract";

// Ephemeral synthetic credentials; no real agent token is read or printed.
export async function createTestAgent() {
  const credential = createAgentCredential();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await pool.query(
    "insert into agent_credentials (id,label,token_hash,scopes,expires_at) values ($1,$2,$3,$4,$5)",
    [
      credential.id,
      "E2E Codex",
      credential.tokenHash,
      JSON.stringify([AgentScope.Read, AgentScope.Submit]),
      new Date(Date.now() + 86400000),
    ],
  );
  return {
    token: credential.token,
    async cleanup() {
      await pool.query("delete from agent_credentials where id=$1", [
        credential.id,
      ]);
      await pool.end();
    },
  };
}
