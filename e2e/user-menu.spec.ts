import { expect, test, type Page } from "@playwright/test";

import { createTestSession, type TestSession } from "./helpers/session";

test.describe("signed-in user", () => {
  let session: TestSession;

  test.beforeEach(async ({ context }) => {
    session = await createTestSession();
    await context.addCookies([session.cookie]);
  });

  test.afterEach(async () => {
    await session.cleanup();
  });

  test("can open the account menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    // Regression: Base UI GroupLabel outside a Group crashed the menu here.
    await expect(
      page.getByRole("menu").getByText(session.userName, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Sign out" }),
    ).toBeVisible();
    // A reader is not staff, so the admin shortcut is absent.
    await expect(
      page.getByRole("menuitem", { name: "Admin", exact: true }),
    ).toHaveCount(0);
  });

  test("can sign out from the menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  // The account-menu avatar only renders client-side (useSession), so its
  // presence guarantees hydration — clicking Save before hydration would
  // fire a native form submit instead of the react-hook-form handler.
  async function gotoAccountHydrated(page: Page) {
    await page.goto("/account");
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toBeVisible();
  }

  test("can update display name on the account page", async ({ page }) => {
    await gotoAccountHydrated(page);
    await page.getByLabel("Display name").fill("Renamed Tester");
    await page.getByRole("button", { name: "Save" }).click();
    // Filtered because the account page holds a second, idle aria-live
    // region (the delete-account flow's, ACCT-1) — a bare role lookup is
    // ambiguous under strict mode.
    await expect(
      page.getByRole("status").filter({ hasText: "Saved." }),
    ).toBeVisible();
  });

  test("rejects a whitespace-only display name", async ({ page }) => {
    await gotoAccountHydrated(page);
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Display name must be/)).toBeVisible();
  });
});

// Staff reach the admin section from the normal app nav (feedback point 1):
// the account menu carries an "Admin dashboard" shortcut for author/admin.
test.describe("staff user", () => {
  let session: TestSession;

  test.beforeEach(async ({ context }) => {
    session = await createTestSession({
      role: "author",
      userName: "E2E Staff",
    });
    await context.addCookies([session.cookie]);
  });

  test.afterEach(async () => {
    await session.cleanup();
  });

  test("reaches the admin dashboard from the account menu", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Admin", exact: true }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/admin");
    await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
  });
});
