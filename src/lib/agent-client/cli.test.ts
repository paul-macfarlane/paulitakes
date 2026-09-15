import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

const token = "synthetic-cli-token-never-a-real-credential";
const skillPath = resolve("e2e/fixtures/editor-skill.md");
function run(command: string, input = "") {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/agent-review.ts", command],
    {
      env: {
        NODE_ENV: "test",
        PAULITAKES_URL: "http://localhost:3000",
        AGENT_API_TOKEN: token,
        PAULITAKES_EDITOR_SKILL_PATH: skillPath,
      },
      input,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}
it("runs once and emits the full brief, attribution and retry UUID as JSON", () => {
  const result = run("brief");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const bytes = readFileSync(skillPath);
  expect(JSON.parse(result.stdout)).toMatchObject({
    brief: bytes.toString("utf8"),
    skill: {
      name: "paulitakes-editor",
      hash: createHash("sha256").update(bytes).digest("hex"),
    },
  });
  expect(JSON.parse(result.stdout).idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
});
it.each([
  ["submit", "invalid-json"],
  ["read", JSON.stringify({ postId: token })],
  ["publish", "{}"],
])("fails %s with a nonzero exit and sanitized stderr", (command, input) => {
  const result = run(command, input);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain(token);
  expect(result.stderr).not.toContain(input);
});
