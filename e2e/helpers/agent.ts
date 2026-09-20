import { Pool } from "pg";

// Supply a synthetic token to BOTH the local app and Playwright process.
// This helper never provisions credentials or displays the configured value.
export async function createTestAgent(postId: string) {
  const token = process.env.AGENT_API_TOKEN;
  if (!token)
    throw new Error(
      "Agent e2e requires a synthetic AGENT_API_TOKEN on the local app and test process.",
    );
  return {
    token,
    async cleanup() {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
      });
      try {
        await pool.query("delete from agent_receipts where post_id=$1", [
          postId,
        ]);
      } finally {
        await pool.end();
      }
    },
  };
}
