import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";
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
  const client = new Client({ name: "editor-e2e", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "scripts/agent-mcp.mts"],
    env: {
      PAULITAKES_URL: baseURL!,
      AGENT_API_TOKEN: agent.token,
      PAULITAKES_EDITOR_SKILL_PATH: skillPath,
    },
  });
  const call = async (name: string, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0].type).toBe("text");
    return JSON.parse(content[0].text);
  };
  await context.addCookies([owner.cookie]);
  try {
    await client.connect(transport);
    const loaded = await call("load_editor_brief");
    expect(loaded.brief).toBe(await readFile(skillPath, "utf8"));
    expect(loaded.skill.hash).toBe(
      createHash("sha256").update(loaded.brief).digest("hex"),
    );
    const url = `/api/agent/v1/drafts/${post.id}`;
    expect((await page.request.get(url)).status()).toBe(401);
    const headers = { Authorization: `Bearer ${agent.token}` };
    const source = await call("read_draft", { postId: post.id });
    expect(source.snapshot.bodyMd).toBe(original);
    expect(source).not.toHaveProperty("authorId");
    expect(source).not.toHaveProperty("user");
    const proposal = {
      postId: post.id,
      sourceVersion: source.sourceVersion,
      candidate: { ...source.snapshot, bodyMd: candidate },
      idempotencyKey: crypto.randomUUID(),
      notes: {
        summary: "Tighten the take; preserve its voice.",
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
    const receipt = await call("submit_proposal", proposal);
    expect(receipt.replayed).toBe(false);
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator("article")).toContainText(original);
    await page.goto(receipt.reviewPath);
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
    expect(await call("submit_proposal", proposal)).toMatchObject({
      id: receipt.id,
      replayed: true,
    });
    // Reload the retained decision before navigating: an action-triggered
    // refresh must not race this test's editor navigation.
    await page.reload();
    await expect(page.getByText(/Applied review ·/)).toBeVisible();
    await page.getByRole("link", { name: "Open editor", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/posts/${post.id}/edit$`));
    await expect(page.locator("#bodyMd")).toHaveValue(candidate);
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator("article")).toContainText(original);
    await expect(page.locator("article")).not.toContainText(candidate);
    await page.goto(`/admin/posts/${post.id}/edit`);
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
    await client.close();
    await agent.cleanup();
    await post.cleanup();
    await category.cleanup();
    await owner.cleanup();
  }
});
