import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Auto-started local servers inherit this synthetic token. When reusing a
// server, launch it and this runner with the same synthetic AGENT_API_TOKEN.
process.env.AGENT_API_TOKEN ||= randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The warmup project below pre-compiles every route, which removes the
  // dev server's first-hit compile stalls (the historical flake source);
  // the retry budget covers residual latency under fully-parallel load. A
  // retried pass is reported as "flaky" (still visible); a real failure
  // fails every attempt.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  // Headroom over Playwright's 5s default for client-island fetches
  // (comments, likes) under fully-parallel load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  // The "...Bot" UA suffix below rides the ingest's existing bot filter
  // (src/lib/analytics/bot.ts matches "bot" case-insensitively) so the
  // suite's incidental view beacons get dropped instead of polluting
  // dev-DB analytics. The two beacon specs in e2e/analytics.spec.ts opt
  // back in with their own clean-UA context.
  projects: [
    // Serialized route warm-up: hits every app route once so the dev
    // server's on-demand compiles happen before the parallel suite starts.
    // Without it, first-hit compiles under 5-way load exceed test timeouts
    // and rotate flakes across whichever specs lose the race.
    {
      name: "warmup",
      testMatch: /warmup\.setup\.ts/,
    },
    // Mobile-first project (FR-9.4): critical flows must pass at phone width.
    {
      name: "mobile-chrome",
      dependencies: ["warmup"],
      use: {
        ...devices["Pixel 7"],
        userAgent: `${devices["Pixel 7"].userAgent} PaulitakesE2EBot`,
      },
    },
    {
      name: "chromium",
      dependencies: ["warmup"],
      use: {
        ...devices["Desktop Chrome"],
        userAgent: `${devices["Desktop Chrome"].userAgent} PaulitakesE2EBot`,
      },
    },
  ],
  // The suite deliberately drives `next dev`, NOT a production build: with
  // Next 16 cacheComponents, production builds hit an open upstream bug
  // where a fast server action + router.refresh() inside one transition
  // intermittently never settles (useTransition stuck pending, navigations
  // hang) — vercel/next.js#86055. Verified locally: `next start` flaked
  // 9-20 specs per run on exactly that fingerprint; dev mode is unaffected.
  // Revisit prod-mode e2e when the upstream fix ships.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
