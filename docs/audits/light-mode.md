# Light-mode audit — September 2026

Base: staging `b24beeb`. Task: [Audit light mode in PicksLeagues and Paulitakes](https://app.notion.com/p/3d7c4dbb621781e5986cf6219d43782f).

## Objective findings

No shared muted-token change is warranted by the reviewed surfaces. Chromium resolves the existing `oklch(0.51 0.02 255)` muted text to sRGB `(95,103,114)` and the page background to `(250,252,254)`: approximately **5.56:1**, above the [4.5:1 ordinary-text minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Ratios use linearized sRGB relative luminance, not antialiased screenshot pixels. This measures that token pair, not every element or state in the application.

The opt-in capture checks route success, light theme, hydrated article/editor/analytics content, and absence of horizontal page overflow at 390px and 1024px. A populated category-filtered home feed avoids cached empty-feed results after direct fixture seeding. Data is synthetic: one long-form article with headings, emphasis, quote, list and table; a staff identity; and seven days of analytics. The fixture thumbnail is served locally by Playwright, with no external image dependency.

## Visual judgment

Reviewed the feed, long-form article, admin post list, published-post editor and populated analytics at both widths. Body text, muted bylines, field labels, bordered controls, table headings, chart labels and action emphasis remain distinguishable. The cool near-white background and restrained borders support long-form reading; making every border or muted label darker would be a preference, not an evidence-backed correction. No palette change was needed. A subsequent dark-mode audit corrected the shared chart label selector; see `dark-mode.md`.

This is representative visual evidence, not an exhaustive accessibility certification. Focus/error states and real OAuth flows are outside these captures.

## Reproduce safely

Use an empty dedicated localhost database whose name ends in `_light_audit` (this run used `paulitakes_light_audit` on the documented local port 5434). Supply `DATABASE_URL` and synthetic values matching the requirements in `.env.example` through the process environment. OAuth credentials can be `ci-dummy`; use a synthetic Better Auth secret of at least 32 characters and analytics seed of at least 16. Never copy or inspect live environment files. Migrate the dedicated database with `corepack pnpm db:migrate`.

```sh
THEME_CAPTURE=1 corepack pnpm test:e2e e2e/capture-theme.spec.ts --project chromium --no-deps
```

Local Turbopack startup stalled on this machine. Starting `corepack pnpm exec next dev --webpack` with the same synthetic environment before the capture worked; Playwright reused that local server. The production validation also used webpack. No application compiler setting was changed.

The capture now runs both themes serially. The capture refuses non-local or non-audit database names, uses the existing session/fixture helpers, and cleans up its rows. Screenshots go to ignored `test-results/review-screenshots/light-mode/`. The `light-mode-audit` PR label opts into a separate empty CI database and seven-day GitHub Actions artifact. Images never enter Git; regenerate expired evidence when needed.

## Validation

- Focused capture: passed, ten screenshots (five surfaces × two widths).
- Automated gates and any environment limitations are recorded in the PR.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed with the existing React Hook Form compiler warning in `post-editor.tsx`.
- `corepack pnpm test`: 720 passed with the default moderation environment. An initial audit-only `COMMENT_MODERATION_ENABLED=false` override caused the default-value test to fail; removing that override resolved it.
- `corepack pnpm exec next build --webpack`: passed.
- `corepack pnpm test:e2e`: 135 passed, one failed authoring timeout, one flaky authoring case, two opt-in capture skips. See PR for the isolated authoring recheck.
