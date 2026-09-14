import { Pool } from "pg";
import { createProposalDiff } from "../../src/lib/proposals/diff";
import type { ProposalSnapshot } from "../../src/lib/proposals/input";

// Synthetic fixture only: production submission stays behind AIR-5 auth.
// The owning post's cleanup cascades the review and its decision history.
export async function createTestProposal(
  postId: string,
  changes: Partial<ProposalSnapshot> = {},
) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(
      `select title, slug, body_md as "bodyMd", thumbnail_url as "thumbnailUrl", banner_url as "bannerUrl", video_url as "videoUrl", category_id as "categoryId", edit_version as version, status from posts where id=$1`,
      [postId],
    );
    const { version, status, ...fields } = rows[0];
    const base: ProposalSnapshot = { ...fields, tags: [] };
    const candidate = { ...base, ...changes };
    const diff = createProposalDiff(base, candidate);
    const notes = {
      summary: "Keep the author’s first-person fan voice.",
      editorial: ["Tighten the opening without changing the take."],
      facts: [
        {
          claim: "The season starts soon.",
          finding: "Confirm the date before publication.",
          status: "unresolved",
          sources: ["https://example.com/schedule"],
          action: "Check the schedule.",
        },
      ],
      media: [
        {
          suggestion: "Consider a highlight clip.",
          sourceUrl: "https://example.com/highlights",
          mediaUrl: null,
          credit: "League channel",
          altText: "A scoring play",
          permission: "Confirm reuse permission.",
        },
      ],
    };
    const { rows: inserted } = await pool.query(
      `insert into edit_proposals (post_id, agent_id, agent_label, skill, source_version, source_is_public, base, candidate, diff, notes) values ($1, 'e2e-editor', 'Test editor', $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        postId,
        { name: "paulitakes-editor", hash: "a".repeat(64) },
        version,
        status === "published",
        base,
        candidate,
        diff,
        notes,
      ],
    );
    return { id: inserted[0].id as string, base, candidate, diff };
  } finally {
    await pool.end();
  }
}
