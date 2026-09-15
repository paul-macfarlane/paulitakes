import { expect, test } from "@playwright/test";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";
import { createTestAgent } from "./helpers/agent";

test("configured agent submits a review, human applies privately, retries retain the same proposal", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const owner = await createTestSession({ role: "author" });
  const post = await createTestPost({
    authorId: owner.userId,
    categoryId: category.id,
    status: "published",
    bodyMd: "My original take.",
  });
  const agent = await createTestAgent(post.id);
  await context.addCookies([owner.cookie]);
  try {
    const url = `/api/agent/v1/drafts/${post.id}`;
    expect((await page.request.get(url)).status()).toBe(401);
    const headers = { Authorization: `Bearer ${agent.token}` };
    const read = await page.request.get(url, { headers });
    expect(read.status()).toBe(200);
    expect(read.headers()["cache-control"]).toContain("no-store");
    const source = await read.json();
    expect(source.snapshot.bodyMd).toBe("My original take.");
    expect(source).not.toHaveProperty("authorId");
    expect(source).not.toHaveProperty("user");
    const proposal = {
      postId: post.id,
      sourceVersion: source.sourceVersion,
      candidate: { ...source.snapshot, bodyMd: "My sharper take." },
      skill: { name: "paulitakes-editor", hash: "a".repeat(64) },
      notes: {
        summary: "Tighten the take; preserve its voice.",
        editorial: [],
        facts: [],
        media: [],
      },
    };
    const submissionHeaders = {
      ...headers,
      "Idempotency-Key": crypto.randomUUID(),
    };
    const created = await page.request.post("/api/agent/v1/edit-proposals", {
      headers: submissionHeaders,
      data: proposal,
    });
    expect(created.status()).toBe(201);
    const receipt = await created.json();
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator("article")).toContainText("My original take.");
    await page.goto(receipt.reviewPath);
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
    const retry = await page.request.post("/api/agent/v1/edit-proposals", {
      headers: submissionHeaders,
      data: proposal,
    });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({
      id: receipt.id,
      replayed: true,
    });
    // Reload the retained decision before navigating: an action-triggered
    // refresh must not race this test's editor navigation.
    await page.reload();
    await expect(page.getByText(/Applied review ·/)).toBeVisible();
    await page.getByRole("link", { name: "Open editor", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/posts/${post.id}/edit$`));
    await expect(page.locator("#bodyMd")).toHaveValue("My sharper take.");
    await page.goto(`/posts/${post.slug}`);
    await expect(page.locator("article")).toContainText("My original take.");
    await expect(page.locator("article")).not.toContainText("My sharper take.");
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
