import crypto from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { clickUntil } from "./helpers/interaction";
import {
  backdatePostPublishAt,
  createTestCategory,
  createTestSession,
  type TestCategory,
  type TestSession,
} from "./helpers/session";

// Exercises the author content lifecycle end-to-end through the real UI and
// server actions: create a draft in the editor, publish it (and confirm it goes
// public), schedule a future publish, and view the private preview. Auth is a
// seeded author session (no OAuth); a seeded category makes the editor render.

const THUMBNAIL = "https://example.com/e2e-thumb.png";

test.describe("authoring lifecycle", () => {
  let session: TestSession;
  let category: TestCategory;

  test.beforeEach(async ({ context }) => {
    category = await createTestCategory();
    session = await createTestSession({
      role: "author",
      userName: "E2E Author",
    });
    await context.addCookies([session.cookie]);
  });

  test.afterEach(async () => {
    // Author cleanup drops the author's posts first, then the category — both
    // are order-independent (each clears referencing posts defensively).
    await session.cleanup();
    await category.cleanup();
  });

  // Pick THIS test's own category in the currently-visible editor. The editor
  // otherwise defaults to a shared first category, so the post wouldn't be
  // isolated to a category only this test cleans up — and a concurrent test's
  // category cleanup could delete the post (404-ing its edit page). Retry
  // covers pre-hydration clicks on the Base UI Select.
  async function selectOwnCategory(page: Page): Promise<void> {
    const categoryTrigger = page.locator("#category:visible");
    await expect(async () => {
      await categoryTrigger.click({ timeout: 3000 });
      await page
        .getByRole("option", { name: category.name })
        .click({ timeout: 3000 });
      await expect(categoryTrigger).toContainText(category.name);
    }).toPass({ timeout: 15000 });
  }

  // Creates a draft through the editor and returns its id + resolved slug.
  // The editor assigns the id on first (explicit) save and navigates to the
  // edit route (router.replace), so we read the id back from the URL.
  async function createDraft(
    page: Page,
    title: string,
  ): Promise<{ id: string; slug: string }> {
    await page.goto("/admin/posts/new");
    await expect(page.getByRole("heading", { name: "New post" })).toBeVisible();

    await selectOwnCategory(page);

    // Target editor fields by id — getByLabel("Body") is ambiguous (the
    // Write/Preview toggle group is aria-label="Body view").
    await page.locator("#title").fill(title);
    await page.locator("#thumbnailUrl").fill(THUMBNAIL);
    await page.locator("#bodyMd").fill("First take. **Bold** and clear.");

    // A single filled form + "Save now" must persist the draft. clickUntil only
    // re-clicks (never re-edits), so if the editor regressed to skipping the
    // first save until a post-hydration field change, this would time out.
    // Filtered because the save navigates (router.replace) to the edit route,
    // where more aria-live regions mount (delete controls, route announcer) —
    // a bare role lookup races that navigation and trips strict mode.
    const status = page.getByRole("status").filter({ hasText: "Saved" });
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(status).toBeVisible(),
    );

    await page.waitForURL(/\/admin\/posts\/[^/]+\/edit/);
    const id = page.url().match(/\/admin\/posts\/([^/]+)\/edit/)?.[1];
    expect(id, "post id in edit URL").toBeTruthy();

    // Load the server-rendered edit page so the status/schedule islands mount.
    await page.goto(`/admin/posts/${id}/edit`);
    // react-hook-form populates the uncontrolled slug field on the client after
    // hydration, so wait for its server-derived value before reading it.
    const slugInput = page.locator("#slug");
    await expect(slugInput).not.toHaveValue("");
    const slug = await slugInput.inputValue();
    return { id: id!, slug };
  }

  test("publishes a draft and it renders on the public site", async ({
    page,
  }) => {
    const title = `E2E Publish ${crypto.randomUUID().slice(0, 8)}`;
    // createDraft leaves the page on the edit view, status controls mounted.
    const { slug } = await createDraft(page, title);

    await clickUntil(page.getByRole("button", { name: "Publish now" }), () =>
      expect(page.getByText("Published")).toBeVisible(),
    );

    const response = await page.goto(`/posts/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Reader can get back to the post list from a post (public back-link).
    await page.getByRole("link", { name: "← All posts" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/");
    await expect(
      page.getByRole("heading", { name: "Paulitakes" }),
    ).toBeVisible();
  });

  test("schedules a future publish (not yet public)", async ({ page }) => {
    const title = `E2E Schedule ${crypto.randomUUID().slice(0, 8)}`;
    const { slug } = await createDraft(page, title);

    await page.locator("#schedule-publish").fill("2030-06-01T12:00");
    await clickUntil(
      page.getByRole("button", { name: "Schedule", exact: true }),
      () => expect(page.getByText("Scheduled to publish")).toBeVisible(),
    );

    // Status badge reflects the scheduled state.
    await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

    // A future publish_at means it isn't publicly visible yet (visiblePostsWhere).
    // notFound() can stream a 200 document, so assert the boundary, not status.
    await page.goto(`/posts/${slug}`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  });

  test("edits to a published post stay staged until published", async ({
    page,
  }) => {
    const title = `E2E Staged ${crypto.randomUUID().slice(0, 8)}`;
    const { id, slug } = await createDraft(page, title);

    // The action can stream the badge before its full reload. Wait for the
    // new document before editing so the form and version are initialized.
    await Promise.all([
      page.waitForEvent("load"),
      clickUntil(page.getByRole("button", { name: "Publish now" }), () =>
        expect(page.getByText("Published")).toBeVisible(),
      ),
    ]);
    await expect(page.locator("#slug")).not.toHaveValue("");

    // Edit the (now published) post's title. This stages a draft rather than
    // writing live; the first staged save surfaces the "Unpublished changes"
    // banner (a sibling island revealed via router.refresh).
    const newTitle = `${title} EDITED`;
    await page.locator("#title").fill(newTitle);
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(page.getByText("Unpublished changes")).toBeVisible(),
    );

    // The public post still shows the ORIGINAL title — staging never touches
    // the live content or its cache. No "Updated" byline yet either: the
    // content_updated_at stamp lands on promote, not on stage (ADR-0016).
    await page.goto(`/posts/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: newTitle })).toHaveCount(0);
    await expect(page.getByText(/Updated/)).toHaveCount(0);

    // Promote the staged changes from the editor.
    await page.goto(`/admin/posts/${id}/edit`);
    await clickUntil(
      page.getByRole("button", { name: "Publish changes" }),
      () => expect(page.getByText("Unpublished changes")).toHaveCount(0),
    );

    // Now the public post reflects the edit — but NO "Updated" byline yet:
    // promote stamped content_updated_at after publish_at, yet both fall on
    // the same calendar day, and a date-only byline would just repeat the
    // publish date (SEO-9, ADR-0028). The exhaustive zone matrix is in
    // src/lib/posts/status.test.ts; this is the one wiring case.
    await expect(async () => {
      await page.goto(`/posts/${slug}`);
      await expect(page.getByRole("heading", { name: newTitle })).toBeVisible();
    }).toPass();
    await expect(page.getByText(/Updated/)).toHaveCount(0);

    // Push the publish two days back (any viewer zone is then a different
    // day) and promote a second edit: the byline gains the "Updated" date
    // (POST-10). Backdate BEFORE the promote — promote is what revalidates
    // post:{slug}; a raw DB write alone leaves the ISR page stale.
    await backdatePostPublishAt(id, 2);
    const finalTitle = `${newTitle} AGAIN`;
    await page.goto(`/admin/posts/${id}/edit`);
    await page.locator("#title").fill(finalTitle);
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(page.getByText("Unpublished changes")).toBeVisible(),
    );
    await clickUntil(
      page.getByRole("button", { name: "Publish changes" }),
      () => expect(page.getByText("Unpublished changes")).toHaveCount(0),
    );
    await expect(async () => {
      await page.goto(`/posts/${slug}`);
      await expect(
        page.getByRole("heading", { name: finalTitle }),
      ).toBeVisible();
    }).toPass();
    await expect(page.getByText(/Updated \w+ \d/)).toBeVisible();
  });

  test("discards staged edits and restores the live values", async ({
    page,
  }) => {
    const title = `E2E Discard ${crypto.randomUUID().slice(0, 8)}`;
    const { id, slug } = await createDraft(page, title);

    // The action can stream the badge before its full reload. Wait for the
    // new document before editing so the form and version are initialized.
    await Promise.all([
      page.waitForEvent("load"),
      clickUntil(page.getByRole("button", { name: "Publish now" }), () =>
        expect(page.getByText("Published")).toBeVisible(),
      ),
    ]);
    await expect(page.locator("#slug")).not.toHaveValue("");

    // Stage an edit (same setup as the "stays staged" spec above).
    const newTitle = `${title} EDITED`;
    await page.locator("#title").fill(newTitle);
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(page.getByText("Unpublished changes")).toBeVisible(),
    );

    // Discard throws the staged draft away. Like "Publish changes", this does
    // a full reload (see PostPendingControls) — the editor re-initializes
    // from the server's now-unstaged post, so the title field must show the
    // ORIGINAL value again, not the discarded edit.
    await clickUntil(
      page.getByRole("button", { name: "Discard changes" }),
      () => expect(page.getByText("Unpublished changes")).toHaveCount(0),
    );
    await expect(page.locator("#title")).toHaveValue(title);

    // The editor's own re-render already reflects the live post now — reload
    // the edit page fresh to also confirm the server-rendered controls agree
    // (no pending-changes banner, Publish/Archive available again).
    await page.goto(`/admin/posts/${id}/edit`);
    await expect(page.getByText("Unpublished changes")).toHaveCount(0);
    await expect(page.locator("#title")).toHaveValue(title);

    // The public post was never touched by the discarded edit either.
    await page.goto(`/posts/${slug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: newTitle })).toHaveCount(0);
  });

  test("shows a draft in the private preview", async ({ page }) => {
    const title = `E2E Preview ${crypto.randomUUID().slice(0, 8)}`;
    const { id } = await createDraft(page, title);

    // The editor's Preview link points at the preview route.
    await expect(page.getByRole("link", { name: "Preview" })).toHaveAttribute(
      "href",
      `/admin/preview/${id}`,
    );

    await page.goto(`/admin/preview/${id}`);
    await expect(page.getByText(/Preview ·/)).toBeVisible();
    await expect(page.getByText("not visible to the public")).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("typing alone does not create a post", async ({ page }) => {
    await page.goto("/admin/posts/new");
    await expect(page.getByRole("heading", { name: "New post" })).toBeVisible();

    const title = `E2E NoAutoCreate ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator("#title").fill(title);
    await page.locator("#bodyMd").fill("Typed but never explicitly saved.");

    // Past one autosave interval (5s), with margin for slow CI — the passive
    // interval tick must never create a post from typing alone (only an
    // explicit action like "Save now" may).
    await page.waitForTimeout(6500);
    expect(new URL(page.url()).pathname).toBe("/admin/posts/new");
  });

  test("new post form starts empty after editing another post", async ({
    page,
  }) => {
    const title = `E2E Reuse ${crypto.randomUUID().slice(0, 8)}`;
    await createDraft(page, title);

    // NOTE: createDraft ends on a full page load (page.goto of the edit
    // route), which tears the SPA tree down — so this spec exercises the
    // post-reload path only. The soft-nav-only path is covered separately by
    // "new post is a clean slate after creating one in the same session".

    // Client-side navigation back to the dashboard and on to a fresh "New
    // post" — no full page load in between, so a stale form/postId would
    // carry over here if create didn't hand off via a real navigation
    // (router.replace) that lets Next remount the editor.
    await page.getByRole("link", { name: "← Posts" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/admin");
    await page.locator('a[href="/admin/posts/new"]').click();
    await page.waitForURL(
      (url) => new URL(url).pathname === "/admin/posts/new",
    );

    await expect(page.getByRole("heading", { name: "New post" })).toBeVisible();
    // ":visible" excludes the previous edit page's form, which Next's client
    // router keeps in the DOM (display: none) for instant back-navigation
    // rather than unmounting it on this soft nav.
    await expect(page.locator("#title:visible")).toHaveValue("");
    await expect(page.locator("#bodyMd:visible")).toHaveValue("");
  });

  // Regression: creating a post on /new hands off with router.replace, a SOFT
  // navigation — Next keeps the /new segment mounted-but-hidden (React
  // Activity) and reveals that same client instance on the next visit. The
  // server re-renders /new with initialPost={null}, but useForm's
  // defaultValues only run on mount, so without the per-render key in
  // new/page.tsx the author came back to the post they had just created —
  // and, because postIdRef survived too, the next save silently UPDATED that
  // post instead of creating another one. Everything here stays on soft
  // navigation: any page.goto() would tear the SPA tree down and hide the bug.
  test("new post is a clean slate after creating one in the same session", async ({
    page,
  }) => {
    await page.goto("/admin/posts/new");
    await expect(page.getByRole("heading", { name: "New post" })).toBeVisible();

    await selectOwnCategory(page);
    const title = `E2E CleanSlate ${crypto.randomUUID().slice(0, 8)}`;
    await page.locator("#title").fill(title);
    await page.locator("#bodyMd").fill("Body of the first post.");
    const status = page.getByRole("status").filter({ hasText: "Saved" });
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(status).toBeVisible(),
    );
    await page.waitForURL(/\/admin\/posts\/[^/]+\/edit/);
    const firstId = page.url().match(/\/admin\/posts\/([^/]+)\/edit/)?.[1];
    expect(firstId, "post id in edit URL").toBeTruthy();

    await page.getByRole("link", { name: "← Posts" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/admin");
    await page.locator('a[href="/admin/posts/new"]').click();
    await page.waitForURL(
      (url) => new URL(url).pathname === "/admin/posts/new",
    );
    await expect(page.getByRole("heading", { name: "New post" })).toBeVisible();

    // ":visible" excludes the hidden edit-page form Next retains for instant
    // back-navigation.
    await expect(page.locator("#title:visible")).toHaveValue("");
    await expect(page.locator("#bodyMd:visible")).toHaveValue("");
    await expect(page.locator("#slug:visible")).toHaveValue("");
    await expect(page.locator("#thumbnailUrl:visible")).toHaveValue("");
    await expect(
      page.getByRole("status").filter({ hasText: "Draft not saved yet" }),
    ).toBeVisible();

    // The decisive assertion: saving here must CREATE a second post, not
    // update the first one.
    await selectOwnCategory(page);
    const secondTitle = `${title} SECOND`;
    await page.locator("#title:visible").fill(secondTitle);
    await clickUntil(page.getByRole("button", { name: "Save now" }), () =>
      expect(page).toHaveURL(/\/admin\/posts\/[^/]+\/edit/),
    );
    const secondId = page.url().match(/\/admin\/posts\/([^/]+)\/edit/)?.[1];
    expect(secondId).not.toBe(firstId);

    // And the first post kept its own title (it was never hijacked).
    await page.goto(`/admin/posts/${firstId}/edit`);
    await expect(page.locator("#title")).toHaveValue(title);
  });

  test("publishing includes keystrokes typed just before publish", async ({
    page,
  }) => {
    const title = `E2E Flush ${crypto.randomUUID().slice(0, 8)}`;
    const { slug } = await createDraft(page, title);

    // Type more body content but neither save manually nor wait for the 5s
    // autosave tick — click Publish now immediately. If PostStatusControls
    // didn't flush the editor's in-progress edits first, the publish would
    // act on the post row as createDraft last left it, missing this text.
    const marker = `flush-marker-${crypto.randomUUID().slice(0, 8)}`;
    await page
      .locator("#bodyMd")
      .fill(`First take. **Bold** and clear. ${marker}`);
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();

    const response = await page.goto(`/posts/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(marker)).toBeVisible();
  });

  test("publishing waits out an in-flight autosave, then persists later keystrokes (F1)", async ({
    page,
  }) => {
    const title = `E2E FlushRace ${crypto.randomUUID().slice(0, 8)}`;
    const { id, slug } = await createDraft(page, title);

    // Real network timing can't reliably land Publish while an autosave
    // tick's request is still in flight — a naive wait-then-click test would
    // be flaky (or pass for the wrong reason if the tick already resolved).
    // Delay the FIRST server-action POST on this edit page instead, so the
    // autosave tick triggered below is deterministically still in flight
    // when Publish is clicked — exercising F1's mid-flight explicit-save
    // path rather than racing it.
    let delayedOnce = false;
    await page.route(`**/admin/posts/${id}/edit*`, async (route) => {
      if (route.request().method() === "POST" && !delayedOnce) {
        delayedOnce = true;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    const marker = `flush-race-marker-${crypto.randomUUID().slice(0, 8)}`;
    await page.locator("#bodyMd").fill("First take, tick capture.");
    // Past one autosave interval (5s) so the tick starts saving — its POST
    // hits the delayed route above and stays in flight for 1.5s.
    await page.waitForTimeout(5500);

    // Type more content, then publish immediately, while the tick's save is
    // still in flight. Before F1, the explicit publish flush piggybacked on
    // that in-flight save and resolved without ever sending this text.
    await page.locator("#bodyMd").fill(`First take, tick capture. ${marker}`);
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible({
      timeout: 15000,
    });

    const response = await page.goto(`/posts/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(marker)).toBeVisible();
  });
});
