import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import {
  createTestCategory,
  createTestPost,
  createTestSession,
} from "./helpers/session";

// Review evidence is opt-in and uses an empty, dedicated local database.
test.skip(
  !process.env.LIGHT_CAPTURE,
  "set LIGHT_CAPTURE=1 for review screenshots",
);
test("capture populated light-mode reading and admin surfaces", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const url = new URL(process.env.DATABASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/_light_audit$/);
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const author = await createTestSession({
    role: "admin",
    userName: "Alex Reader",
  });
  const category = await createTestCategory("Football");
  const post = await createTestPost({
    authorId: author.userId,
    categoryId: category.id,
    title: "A good offense starts with the ordinary plays",
    bodyMd: [
      "The highlight is easy to remember. The quiet work between highlights tells us more about a team.",
      "## Win the early downs",
      "A patient offense keeps its options open. **Protection and timing** matter as much as the deep throw.",
      "> A repeatable plan beats a perfect play drawn once.",
      "## Watch the whole drive",
      "- Protect the middle\n- Give the quarterback an outlet\n- Keep the next down manageable",
      "| Down | Objective |\n| --- | --- |\n| First | Stay on schedule |\n| Third | Know the answer |",
      ...Array.from(
        { length: 6 },
        () =>
          "The best drives make difficult work look ordinary. Watch the spacing, the footwork, and the receiver who clears a lane for someone else. Those details are the difference between an exciting moment and an offense you can trust.",
      ),
    ].join("\n\n"),
  });
  try {
    await pool.query(
      "update posts set publish_at = '2026-09-01T12:00:00Z' where id = $1",
      [post.id],
    );
    await pool.query(
      "insert into page_views (post_id, path, visitor_hash, created_at) select $1, $2, 'light-audit-' || n, current_timestamp - (n % 7) * interval '1 day' from generate_series(1, 28) n",
      [post.id, `/posts/${post.slug}`],
    );
    await context.route("https://example.com/e2e-thumb.png", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263442"/><text x="160" y="100" fill="white" text-anchor="middle" font-size="30">FOOTBALL</text></svg>',
      }),
    );
    await context.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of [
        ["home", `/?category=${category.slug}`],
        ["article", `/posts/${post.slug}`],
        ["posts", "/admin"],
        ["editor", `/admin/posts/${post.id}/edit`],
        ["analytics", "/admin/analytics"],
      ]) {
        if (path.startsWith("/admin"))
          await context.addCookies([author.cookie]);
        const response = await page.goto(path);
        expect(response?.ok()).toBe(true);
        await expect(page.locator("html")).not.toHaveClass(/dark/);
        if (name === "home")
          await expect(
            page.getByRole("link", { name: post.title }),
          ).toBeVisible();
        if (name === "analytics")
          await expect(
            page.locator("svg.recharts-surface").first(),
          ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(
          page.getByRole("button", { name: "Change theme" }),
        ).toBeVisible();
        if (path.startsWith("/admin"))
          await expect(
            page.getByRole("button", { name: "Account menu" }),
          ).toBeVisible();
        else
          await expect(
            page.getByRole("link", { name: "Sign in", exact: true }).first(),
          ).toBeVisible();
        if (name === "editor")
          await expect(
            page.getByRole("textbox", { name: "Title", exact: true }),
          ).toHaveValue(post.title);
        if (name === "article") {
          await expect(
            page.getByRole("button", { name: "Like this post", exact: true }),
          ).toBeVisible();
          await expect(page.getByText("No comments yet.")).toBeVisible();
        }
        await page.addStyleTag({
          content: "nextjs-portal { display: none !important; }",
        });
        await page.screenshot({
          path: `test-results/review-screenshots/light-mode/${name}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(0);
      }
      await context.clearCookies();
    }
  } finally {
    await pool.query("delete from page_views where post_id = $1", [post.id]);
    await pool.end();
    await post.cleanup();
    await category.cleanup();
    await author.cleanup();
  }
});
