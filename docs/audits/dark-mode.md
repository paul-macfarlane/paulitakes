# Dark-mode audit — September 2026

Follow-up requested after the light-mode PR was opened. Reviewed the populated feed, long-form article, admin list/editor and analytics at 390px and 1024px using the same synthetic fixtures as [the light-mode audit](light-mode.md).

## Objective finding: chart axis labels

The analytics captures showed dim axis labels on dark cards. Recharts 3.8 renders text with `recharts-cartesian-axis-tick-value` under a `recharts-cartesian-axis-tick-label` group. The shared chart container still targeted text underneath the separate `recharts-cartesian-axis-tick` group, so its muted-token rule never matched. Labels fell back to Recharts' `#666` in both themes.

On the dark card `(15,21,29)`, `(102,102,102)` text measures **3.19:1**, below the [4.5:1 ordinary-text minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Targeting the tick text itself restores the existing muted token `(150,159,171)`, approximately **6.85:1**. The fix applies centrally to all three analytics charts and preserves the palette. Light charts also receive the intended existing theme color.

The capture now checks actual computed SVG fill against the containing card background for every axis label. This failed at 3.193 before the fix and passes in both themes afterward. This check is part of the opt-in capture, not an added dependency or a new full-suite visual baseline.

## Visual judgment and limits

Other reviewed dark surfaces retain legible body text, bylines, controls and table labels. No broader color change is justified. A temporary axe-core color-contrast scan reported no violations on the ten route/width combinations, but did not identify the SVG axis-label problem; direct rendered-color measurement and visual review supplied that evidence. Axe was not added as a dependency. This is not an exhaustive accessibility certification or a review of every focus/error state.

## Reproduce

Use the dedicated local audit database and synthetic environment described in the light-mode report:

```sh
THEME_CAPTURE=1 corepack pnpm test:e2e e2e/capture-theme.spec.ts --project chromium --no-deps
```

Both themes run serially, with fixture cleanup between them. Append `--grep dark` to inspect only dark mode. Outputs are ignored `test-results/review-screenshots/{light,dark}-mode/` directories. The existing `light-mode-audit` PR label now captures both themes; the seven-day artifact includes all light surfaces plus the dark article and corrected analytics. The label keeps its original name so current review links and workflow opt-in remain stable.

## Validation

- Typecheck and lint passed (one existing React Hook Form warning).
- Production build with `corepack pnpm exec next build --webpack` passed.
- Both theme captures passed: 20 images, with the rendered chart-contrast check verified to fail before the selector fix.
- Final `corepack pnpm test:e2e --workers 2`: 133 passed, one post-delete navigation failure, three timing flakes, four intended capture skips. The failure was in an unchanged deletion journey (`net::ERR_ABORTED` on retry); the full local run is not claimed green. CI remains the merge gate.
