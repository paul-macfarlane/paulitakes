import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";

for (const status of ["draft", "published"] as const) {
  test(`stale ${status} editor keeps its buffer, pauses autosave, exports and reloads`, async ({
    browser,
  }, testInfo) => {
    const category = await createTestCategory();
    const session = await createTestSession({ role: "author" });
    const post = await createTestPost({
      authorId: session.userId,
      categoryId: category.id,
      status,
      bodyMd: "Original saved body.",
    });
    const context = await browser.newContext({
      baseURL: "http://localhost:3000",
      viewport: {
        width: testInfo.project.name === "mobile-chrome" ? 390 : 1024,
        height: 844,
      },
      userAgent: "PaulitakesE2EBot",
    });
    await context.addCookies([session.cookie]);
    const first = await context.newPage();
    const stale = await context.newPage();
    try {
      for (const page of [first, stale]) {
        await page.goto(`/admin/posts/${post.id}/edit`);
        await expect(page.locator("#title")).toHaveValue(post.title);
        await expect(page.locator("#bodyMd")).toHaveValue(
          "Original saved body.",
        );
      }
      await first.locator("#bodyMd").fill("Newer saved body.");
      await first.getByRole("button", { name: "Save now" }).click();
      await expect(
        first.getByRole("status").filter({ hasText: "Saved" }),
      ).toBeVisible();

      await stale.locator("#bodyMd").fill("My unsaved local body.");
      await stale.locator("#title").fill("My local title");
      await stale.locator("#tags").fill("local, notes");
      await stale.getByRole("button", { name: "Save now" }).click();
      await expect(
        stale.getByRole("heading", { name: "A newer edit exists" }),
      ).toBeVisible();
      if (process.env.CAPTURE_REVIEW === "1" && status === "draft") {
        await stale.screenshot({
          path: `test-results/review-screenshots/conflict-${testInfo.project.name}.png`,
          fullPage: true,
        });
      }
      let actionRequests = 0;
      stale.on("request", (request) => {
        if (request.headers()["next-action"]) actionRequests++;
      });
      // Cross an actual autosave tick: a stale editor must not retry in a loop.
      await stale.waitForTimeout(5500);
      await stale.getByRole("button", { name: "Save now" }).click();
      expect(actionRequests).toBe(0);
      await expect(stale.locator("#bodyMd")).toHaveValue(
        "My unsaved local body.",
      );
      await expect(stale.locator("#tags")).toHaveValue("local, notes");

      const downloadEvent = stale.waitForEvent("download");
      await stale
        .getByRole("button", { name: "Download my unsaved work" })
        .click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe(`unsaved-post-${post.id}.md`);
      const markdown = await readFile((await download.path())!, "utf8");
      expect(markdown).toContain("## Title\n\nMy local title");
      expect(markdown).toContain("## Tags\n\nlocal, notes");
      expect(markdown).toContain(`## Category\n\n${category.name}`);
      expect(markdown).toContain(`## Category ID\n\n${category.id}`);
      expect(markdown).toContain("## Thumbnail URL\n\n");
      expect(markdown).toContain("## Banner URL\n\n");
      expect(markdown).toContain("## Video URL\n\n");
      expect(markdown).toContain("## Slug\n\n");
      expect(markdown).toMatch(/## Post body\n\nMy unsaved local body\.$/);
      await stale
        .getByRole("button", { name: "Reload latest", exact: true })
        .click();
      await stale.getByRole("button", { name: "Keep editing locally" }).click();
      await expect(stale.locator("#bodyMd")).toHaveValue(
        "My unsaved local body.",
      );
      await stale
        .getByRole("button", { name: "Reload latest", exact: true })
        .click();
      await stale.getByRole("button", { name: "Reload and replace" }).click();
      await expect(stale.locator("#bodyMd")).toHaveValue("Newer saved body.");
      await expect(stale.locator("#title")).toHaveValue(post.title);
      await expect(
        stale.getByRole("heading", { name: "A newer edit exists" }),
      ).toHaveCount(0);
      // New token works after deliberate recovery; no accidental permanent pause.
      await stale.locator("#bodyMd").fill("Fresh edit after reload.");
      await stale.getByRole("button", { name: "Save now" }).click();
      await expect(
        stale.getByRole("status").filter({ hasText: "Saved" }),
      ).toBeVisible();
      if (status === "published") {
        const publicPage = await context.newPage();
        await publicPage.goto(`/posts/${post.slug}`);
        await expect(
          publicPage.getByText("Original saved body.", { exact: true }),
        ).toBeVisible();
        await expect(
          publicPage.getByText("Fresh edit after reload.", { exact: true }),
        ).toHaveCount(0);
      }
    } finally {
      await context.close();
      await post.cleanup();
      await session.cleanup();
      await category.cleanup();
    }
  });
}
