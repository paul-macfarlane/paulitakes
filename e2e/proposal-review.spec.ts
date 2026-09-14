import { expect, test } from "@playwright/test";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";
import { createTestProposal } from "./helpers/proposals";

for (const status of ["draft", "published"] as const) {
  test(`human selectively applies a ${status} review and retains its decision`, async ({
    page,
    context,
  }, testInfo) => {
    const category = await createTestCategory();
    const session = await createTestSession({ role: "author" });
    const post = await createTestPost({
      authorId: session.userId,
      categoryId: category.id,
      status,
      bodyMd: "I like this team.\n\nKeep my fan voice.\n",
    });
    const proposal = await createTestProposal(post.id, {
      title: "A sharper title",
      ...(status === "published" ? { slug: `${post.slug}-updated` } : {}),
      bodyMd: "I love this team.\n\nKeep my fan voice.\n",
    });
    await context.addCookies([session.cookie]);
    try {
      await page.goto(`/admin/posts/${post.id}/edit`);
      await expect(page.locator("#title")).toHaveValue(post.title);
      await page
        .getByRole("button", { name: "AI reviews", exact: true })
        .click();
      await page.getByRole("link", { name: /Open review/ }).click();
      await expect(
        page.getByRole("heading", { name: "Review suggestions" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Apply selected changes",
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByText("Full comparison — all text and fields", { exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Reviewed snapshot" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Complete suggestion" }),
      ).toBeVisible();
      await page
        .getByText("Full comparison — all text and fields", { exact: true })
        .click();
      await page.getByText(/Editorial notes ·/).click();
      await expect(
        page.getByRole("link", {
          name: "https://example.com/schedule",
          exact: true,
        }),
      ).toHaveAttribute("rel", "noopener noreferrer");
      await expect(
        page.getByText("Confirm reuse permission.", { exact: false }),
      ).toBeVisible();
      await page.getByText(/Editorial notes ·/).click();
      await page
        .getByRole("checkbox", { name: "Body change 1", exact: true })
        .check();
      await page
        .getByRole("button", { name: "Preview selected result" })
        .click();
      await expect(page.getByTestId("rendered-selection")).toContainText(
        "I love this team.",
      );
      await expect(page.getByTestId("rendered-selection")).not.toContainText(
        "Confirm the date",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      if (process.env.CAPTURE_REVIEW === "1" && status === "draft") {
        await page.setViewportSize({
          width: testInfo.project.name === "mobile-chrome" ? 390 : 1024,
          height: 844,
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `test-results/review-screenshots/review-${testInfo.project.name}.png`,
          fullPage: true,
        });
        await page.evaluate(() =>
          document.documentElement.classList.add("dark"),
        );
        await page.screenshot({
          path: `test-results/review-screenshots/review-dark-${testInfo.project.name}.png`,
          fullPage: true,
        });
      }
      if (status === "published") {
        await page.getByRole("checkbox", { name: "Slug", exact: true }).check();
        await page
          .getByRole("button", { name: "Apply selected changes", exact: true })
          .click();
        await expect(
          page.getByText("You selected a new slug.", { exact: false }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page
          .getByRole("checkbox", { name: "Slug", exact: true })
          .uncheck();
      }
      await page
        .getByRole("button", { name: "Apply selected changes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm apply", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        status === "published"
          ? "Changes saved as pending edits."
          : "Selected changes saved.",
      );
      await page.reload();
      await expect(page.getByText(/Applied review ·/)).toBeVisible();
      await expect(
        page.getByRole("checkbox", { name: /Body change 1/ }),
      ).toBeChecked();
      await expect(
        page.getByRole("checkbox", { name: /Title/ }),
      ).not.toBeChecked();
      await page
        .getByRole("link", { name: "Open editor", exact: true })
        .click();
      await expect(page.locator("#title")).toHaveValue(post.title);
      await expect(page.locator("#bodyMd")).toHaveValue(
        proposal.candidate.bodyMd,
      );
      if (status === "published") {
        await expect(
          page.getByRole("button", { name: "Publish changes", exact: true }),
        ).toBeVisible();
        await page.goto(`/posts/${post.slug}`);
        await expect(page.locator("article")).toContainText(
          "I like this team.",
        );
        await expect(page.locator("article")).not.toContainText(
          "I love this team.",
        );
      }
    } finally {
      await post.cleanup();
      await category.cleanup();
      await session.cleanup();
    }
  });
}

test("saving on review navigation makes an older review stale, with safe rejection", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const session = await createTestSession({ role: "author" });
  const post = await createTestPost({
    authorId: session.userId,
    categoryId: category.id,
    status: "draft",
  });
  const proposal = await createTestProposal(post.id, {
    title: "Suggested title",
  });
  await context.addCookies([session.cookie]);
  try {
    await page.goto(`/admin/posts/${post.id}/edit`);
    await expect(page.locator("#title")).toHaveValue(post.title);
    await page.locator("#title").fill("");
    await page.getByRole("button", { name: "AI reviews", exact: true }).click();
    await expect(
      page.getByText(
        "Save your edits or resolve the save conflict before opening reviews.",
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/posts/${post.id}/edit$`));
    await page.locator("#title").fill(post.title);
    await page.locator("#bodyMd").fill("My new unsaved take.");
    await page.getByRole("button", { name: "AI reviews", exact: true }).click();
    await page.getByRole("link", { name: /Open review/ }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "This review is out of date.",
    );
    await expect(
      page.getByRole("button", { name: "Apply selected changes", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Reject review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm rejection", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Review rejected.");
    await page.getByRole("link", { name: "Open editor", exact: true }).click();
    await expect(page.locator("#bodyMd")).toHaveValue("My new unsaved take.");
    await page.goto(`/admin/posts/${post.id}/reviews/${proposal.id}`);
    await expect(page.getByText(/Rejected review ·/)).toBeVisible();
  } finally {
    await post.cleanup();
    await category.cleanup();
    await session.cleanup();
  }
});

test("another author cannot open review content or history", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const owner = await createTestSession({ role: "author" });
  const stranger = await createTestSession({ role: "author" });
  const post = await createTestPost({
    authorId: owner.userId,
    categoryId: category.id,
    status: "draft",
  });
  const proposal = await createTestProposal(post.id, {
    title: "Private proposed title",
  });
  await context.addCookies([stranger.cookie]);
  try {
    for (const path of [
      `/admin/posts/${post.id}/reviews`,
      `/admin/posts/${post.id}/reviews/${proposal.id}`,
    ]) {
      await page.goto(path);
      await expect(page.getByText("404", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Private proposed title", { exact: true }),
      ).toHaveCount(0);
    }
  } finally {
    await post.cleanup();
    await category.cleanup();
    await owner.cleanup();
    await stranger.cleanup();
  }
});

test("an in-flight review refuses newer saved content and keeps the post intact", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const session = await createTestSession({ role: "author" });
  const post = await createTestPost({
    authorId: session.userId,
    categoryId: category.id,
    status: "draft",
  });
  const proposal = await createTestProposal(post.id, { title: "Old AI title" });
  await context.addCookies([session.cookie]);
  const editor = await context.newPage();
  try {
    await page.goto(`/admin/posts/${post.id}/reviews/${proposal.id}`);
    await page.getByRole("checkbox", { name: "Title", exact: true }).check();
    await editor.goto(`/admin/posts/${post.id}/edit`);
    await expect(editor.locator("#title")).toHaveValue(post.title);
    await editor.locator("#bodyMd").fill("A newer human edit.");
    await editor.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(
      editor.getByRole("status").filter({ hasText: "Saved" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm apply", exact: true })
      .click();
    await expect(
      page.getByText("This review can no longer be applied.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply selected changes", exact: true }),
    ).toBeDisabled();
    await editor.reload();
    await expect(editor.locator("#bodyMd")).toHaveValue("A newer human edit.");
    await expect(editor.locator("#title")).toHaveValue(post.title);
  } finally {
    await editor.close();
    await post.cleanup();
    await category.cleanup();
    await session.cleanup();
  }
});

test("notes-only reviews can be read and rejected", async ({
  page,
  context,
}) => {
  const category = await createTestCategory();
  const session = await createTestSession({ role: "author" });
  const post = await createTestPost({
    authorId: session.userId,
    categoryId: category.id,
    status: "draft",
  });
  const proposal = await createTestProposal(post.id);
  await context.addCookies([session.cookie]);
  try {
    await page.goto(`/admin/posts/${post.id}/reviews/${proposal.id}`);
    await expect(
      page.getByText(
        "This review contains notes only, with no content changes to apply.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Apply selected changes", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Reject review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm rejection", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Review rejected.");
  } finally {
    await post.cleanup();
    await category.cleanup();
    await session.cleanup();
  }
});
