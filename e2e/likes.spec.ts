import { config } from "dotenv";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";

import {
  createTestCategory,
  createTestComment,
  createTestPost,
  createTestSession,
  type TestCategory,
  type TestComment,
  type TestPost,
  type TestSession,
} from "./helpers/session";

config({ quiet: true });

// Public like buttons (LIKE-3, design §5.4): the toggle is a plain server
// action + useOptimistic, no moderation involved — deterministic e2e
// coverage seeds a pre-existing like directly via SQL (mirrors
// moderation.spec.ts's seedComment helper) rather than driving a second
// browser session, then drives the real tap/reload flow for both the post
// and a comment.

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set (see .env.example)");
  }
  return databaseUrl;
}

async function seedPostLike(postId: string, userId: string): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  await pool.query(
    `insert into post_likes (post_id, user_id) values ($1, $2)`,
    [postId, userId],
  );
  await pool.end();
}

async function seedCommentLike(
  commentId: string,
  userId: string,
): Promise<void> {
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  await pool.query(
    `insert into comment_likes (comment_id, user_id) values ($1, $2)`,
    [commentId, userId],
  );
  await pool.end();
}

// The button's aria-pressed/count flip optimistically on click (like-button
// useOptimistic) BEFORE the server action commits — reloading right after
// the UI assertion can abort the in-flight action and lose the write. Poll
// the DB for the committed row count before any reload so the persistence
// assertions read settled state, not a race.
async function pollLikeCount(
  table: "post_likes" | "comment_likes",
  targetId: string,
  expected: number,
): Promise<void> {
  const column = table === "post_likes" ? "post_id" : "comment_id";
  const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  try {
    await expect
      .poll(async () => {
        const res = await pool.query<{ n: number }>(
          `select count(*)::int as n from ${table} where ${column} = $1`,
          [targetId],
        );
        return res.rows[0]!.n;
      })
      .toBe(expected);
  } finally {
    await pool.end();
  }
}

test.describe("like buttons", () => {
  let author: TestSession;
  let category: TestCategory;
  let post: TestPost;
  let comment: TestComment;

  test.beforeEach(async () => {
    author = await createTestSession({
      role: "author",
      userName: "E2E Like Author",
    });
    category = await createTestCategory();
    post = await createTestPost({
      authorId: author.userId,
      categoryId: category.id,
    });
    comment = await createTestComment({
      postId: post.id,
      authorId: author.userId,
      body: "A comment to like.",
    });
    // Baseline like from the author on both the post and the comment — gives
    // a signed-out visitor and a fresh reader something other than zero to
    // read/increment (post_likes/comment_likes cascade off posts/comments,
    // schema.ts, so post.cleanup() alone removes these too).
    await seedPostLike(post.id, author.userId);
    await seedCommentLike(comment.id, author.userId);
  });

  test.afterEach(async () => {
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
  });

  test("signed-out visitor sees like counts but a tap shows a sign-in link", async ({
    page,
  }) => {
    await page.goto(`/posts/${post.slug}`);

    const postLikeButton = page.getByRole("button", { name: "Like this post" });
    await expect(postLikeButton).toContainText("1");
    const commentLikeButton = page.getByRole("button", {
      name: "Like this comment",
    });
    await expect(commentLikeButton).toContainText("1");

    await postLikeButton.click();
    const signInLink = page
      .getByRole("status")
      .filter({ hasText: "to like this." })
      .getByRole("link", { name: "Sign in" });
    await expect(signInLink).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent(`/posts/${post.slug}`)}`,
    );
    // No optimistic flip happened — still just the baseline count.
    await expect(postLikeButton).toContainText("1");
    await expect(postLikeButton).toHaveAttribute("aria-pressed", "false");
  });

  test("signed-in reader toggles the post like, and it persists across reload", async ({
    page,
    context,
  }) => {
    const reader = await createTestSession({ userName: "E2E Like Reader" });
    await context.addCookies([reader.cookie]);

    try {
      await page.goto(`/posts/${post.slug}`);
      const postLikeButton = page.getByRole("button", {
        name: "Like this post",
      });
      await expect(postLikeButton).toContainText("1");
      await expect(postLikeButton).toHaveAttribute("aria-pressed", "false");

      await postLikeButton.click();
      await expect(postLikeButton).toHaveAttribute("aria-pressed", "true");
      await expect(postLikeButton).toContainText("2");
      await pollLikeCount("post_likes", post.id, 2);

      await page.reload();
      const reloadedButton = page.getByRole("button", {
        name: "Like this post",
      });
      await expect(reloadedButton).toHaveAttribute("aria-pressed", "true");
      await expect(reloadedButton).toContainText("2");

      await reloadedButton.click();
      await expect(reloadedButton).toHaveAttribute("aria-pressed", "false");
      await expect(reloadedButton).toContainText("1");
      await pollLikeCount("post_likes", post.id, 1);

      await page.reload();
      const untoggledButton = page.getByRole("button", {
        name: "Like this post",
      });
      await expect(untoggledButton).toHaveAttribute("aria-pressed", "false");
      await expect(untoggledButton).toContainText("1");
    } finally {
      await reader.cleanup();
    }
  });

  test("signed-in reader likes a comment and it persists across reload", async ({
    page,
    context,
  }) => {
    const reader = await createTestSession({ userName: "E2E Like Reader" });
    await context.addCookies([reader.cookie]);

    try {
      await page.goto(`/posts/${post.slug}`);
      const commentLikeButton = page.getByRole("button", {
        name: "Like this comment",
      });
      await expect(commentLikeButton).toContainText("1");

      await commentLikeButton.click();
      await expect(commentLikeButton).toHaveAttribute("aria-pressed", "true");
      await expect(commentLikeButton).toContainText("2");
      await pollLikeCount("comment_likes", comment.id, 2);

      await page.reload();
      const reloadedButton = page.getByRole("button", {
        name: "Like this comment",
      });
      await expect(reloadedButton).toHaveAttribute("aria-pressed", "true");
      await expect(reloadedButton).toContainText("2");
    } finally {
      await reader.cleanup();
    }
  });

  // SEO-1: one representative wiring case (not a matrix) for the post page's
  // generateMetadata — reuses this describe block's already-seeded published
  // post rather than seeding a dedicated fixture elsewhere.
  test("post page exposes canonical URL and Open Graph/Twitter metadata", async ({
    page,
  }) => {
    const response = await page.goto(`/posts/${post.slug}`);
    expect(response?.status()).toBe(200);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/posts/${post.slug}$`),
    );
    // Fixed thumbnail seeded by createTestPost (helpers/session.ts).
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://example.com/e2e-thumb.png",
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /.+/,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
  });
});
