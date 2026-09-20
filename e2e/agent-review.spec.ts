import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  proposalSnapshotSchema,
  skillAttributionSchema,
} from "../src/lib/proposals/input";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";
import { clickUntil } from "./helpers/interaction";
import { createTestAgent } from "./helpers/agent";

test("configured agent submits a review, human applies privately, retries retain the same proposal", async ({
  page,
  context,
  baseURL,
}) => {
  // This crosses a CLI, several UI navigations, private apply and publication.
  test.setTimeout(60_000);
  const original =
    "Look, I still believe in these guys. The defense were shaky.";
  const candidate =
    "Look, I still believe in these guys. The defense was shaky.";
  const category = await createTestCategory();
  const owner = await createTestSession({ role: "author" });
  const post = await createTestPost({
    authorId: owner.userId,
    categoryId: category.id,
    status: "published",
    bodyMd: original,
  });
  const agent = await createTestAgent(post.id);
  const skillPath = resolve("e2e/fixtures/editor-skill.md");
  const call = (command: string, input = {}): Promise<unknown> =>
    new Promise((resolveResult, reject) => {
      const child = execFile(
        process.execPath,
        ["--import", "tsx", "scripts/agent-review.ts", command],
        {
          env: {
            NODE_ENV: "test",
            PAULITAKES_URL: baseURL!,
            AGENT_API_TOKEN: agent.token,
            PAULITAKES_EDITOR_SKILL_PATH: skillPath,
          },
          timeout: 40_000,
        },
        (error, stdout, stderr) => {
          if (error)
            return reject(new Error(stderr || "Review command failed"));
          try {
            resolveResult(JSON.parse(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
      child.stdin!.end(JSON.stringify(input));
    });
  await context.addCookies([owner.cookie]);
  try {
    const loaded = z
      .object({
        brief: z.string(),
        skill: skillAttributionSchema,
        idempotencyKey: z.uuid(),
      })
      .parse(await call("brief"));
    expect(loaded.brief).toBe(await readFile(skillPath, "utf8"));
    expect(loaded.skill.hash).toBe(
      createHash("sha256").update(loaded.brief).digest("hex"),
    );
    const url = `/api/agent/v1/drafts/${post.id}`;
    expect((await page.request.get(url)).status()).toBe(401);
    const headers = { Authorization: `Bearer ${agent.token}` };
    const source = z
      .looseObject({
        snapshot: proposalSnapshotSchema,
        sourceVersion: z.uuid(),
      })
      .parse(await call("read", { postId: post.id }));
    expect(source.snapshot.bodyMd).toBe(original);
    expect(source).not.toHaveProperty("authorId");
    expect(source).not.toHaveProperty("user");
    const comparison = z
      .object({
        changes: z.array(
          z.object({
            changeId: z.string(),
            before: z.string(),
            after: z.string(),
          }),
        ),
      })
      .parse(
        await call("compare", {
          base: source.snapshot,
          candidate: { ...source.snapshot, bodyMd: candidate },
        }),
      );
    const proposal = {
      postId: post.id,
      sourceVersion: source.sourceVersion,
      candidate: { ...source.snapshot, bodyMd: candidate },
      idempotencyKey: loaded.idempotencyKey,
      skillHash: loaded.skill.hash,
      notes: {
        summary: "Tighten the take; preserve its voice.",
        changes: comparison.changes.map((change) => ({
          ...change,
          explanation:
            "Use singular agreement for defense; preserve the fan voice.",
          sources: [],
        })),
        editorial: [
          "Correct subject–verb agreement; retain the first-person fan voice.",
        ],
        facts: [
          {
            claim: "The defense was shaky.",
            finding:
              "No game/date supplied; specific performance claims remain unverified.",
            status: "unresolved",
            sources: [],
            action:
              "Retain as opinion; confirm game context before adding statistics.",
          },
        ],
        media: [
          {
            suggestion: "Optional defensive highlight clip",
            sourceUrl: null,
            mediaUrl: null,
            credit: "Unknown",
            altText: "Defensive play from the referenced game",
            permission: "Unverified; locate an official source before use.",
          },
        ],
      },
    };
    const receipt = z
      .object({ id: z.uuid(), reviewPath: z.string(), replayed: z.boolean() })
      .parse(await call("submit", proposal));
    expect(receipt.replayed).toBe(false);
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator("article")).toContainText(original);
    // Dev refreshes may interrupt navigation immediately after a route compiles.
    await expect(async () => {
      await page.goto(receipt.reviewPath);
      await expect(
        page.getByText(
          "Use singular agreement for defense; preserve the fan voice.",
          { exact: true },
        ),
      ).toBeVisible();
    }).toPass();
    await page
      .locator("summary")
      .filter({ hasText: "Editorial notes" })
      .click();
    await expect(
      page.getByText("Optional defensive highlight clip", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No game/date supplied; specific performance claims remain unverified.",
        { exact: false },
      ),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Body change 1", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm apply", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Changes saved as pending edits.",
    );
    expect(await call("submit", proposal)).toMatchObject({
      id: receipt.id,
      replayed: true,
    });
    // Reload the retained decision before navigating: an action-triggered
    // refresh must not race this test's editor navigation.
    await page.reload();
    await expect(page.getByText(/Applied review ·/)).toBeVisible();
    await clickUntil(
      page.getByRole("link", { name: "Open editor", exact: true }),
      () => expect(page).toHaveURL(new RegExp(`/admin/posts/${post.id}/edit$`)),
    );
    await expect(page.locator("#bodyMd")).toHaveValue(candidate);
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator("article")).toContainText(original);
    await expect(page.locator("article")).not.toContainText(candidate);
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page.getByText("Unpublished changes")).toBeVisible();
    await clickUntil(
      page.getByRole("button", { name: "Publish changes", exact: true }),
      () => expect(page.getByText("Unpublished changes")).toHaveCount(0),
    );
    await expect(async () => {
      await page.goto(`/posts/${post.slug}`);
      await expect(page.locator("article")).toContainText(candidate);
    }).toPass();
    await expect(page.locator("article")).not.toContainText(
      "Optional defensive highlight clip",
    );
    await expect(page.locator("article")).not.toContainText(
      "No game/date supplied",
    );
    expect(
      (
        await page.request.delete("/api/agent/v1/edit-proposals", { headers })
      ).status(),
    ).toBe(405);
  } finally {
    await agent.cleanup();
    await post.cleanup();
    await category.cleanup();
    await owner.cleanup();
  }
});
