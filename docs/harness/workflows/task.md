# Task workflow

Follow `AGENTS.md`; explicit user scope overrides commit/push/PR defaults below. Paths are repository-root relative.

Run the implementation pipeline for: **the user-supplied arguments**

A "task" may be one backlog item, several related items, or a whole epic — scope it from the argument.

## Target & setup

- **Target:** `next` = the first `[ ]` in build order (`backlog/README.md`: Priority list first while open, then epic table) whose `deps:` are all `[x]`. A task ID (e.g. `POST-3`) = that item. An epic prefix (e.g. `POST`) = that epic's open tasks in order. Nothing runnable → say so and stop.
- Mark the task `[~]` and state the resolved target in one line.
- **Branch first:** create `feat/<task-id-or-epic-slug>` off `staging` before touching code. Preserve unrelated uncommitted changes; if they prevent safe isolation, ask before proceeding. Follow an explicit user or host branch naming convention when supplied.

You implement directly — planning, coding, and verification stay in this conversation with full context. Independent read-only survey agents may be used for genuinely broad surveys when available; otherwise survey sequentially; a question one or two files can answer, read directly. Never hand auth/ownership gating, the visibility predicate, or comment moderation to a subagent: this repo's bugs live there.

**Rule of three.** If the work would create a third copy of anything — a constant, a guard block, a query predicate, a test fixture — extract it to a shared home first.

## 1. Clarify

**Mandatory for work touching user-visible behavior or a `docs/product-doc.md` FR.** After reading the task and its doc sections, ask the batched requirement and edge-case questions via the host question facility, or a concise plain-text question if unavailable, each with a recommended answer, and wait. Purely mechanical work (refactors, tooling, dep bumps) proceeds without stopping — say so. For feature work, "no questions" is itself a claim: state what makes the contract complete enough to skip.

## 2. Execute

Know the plan before coding, at the weight the task deserves — a few sentences for a contained change; files, approach, applicable FR-x.y / `docs/technical-design.md` §sections, and any decision needing an ADR for multi-file or risk-surface work. Verify current-state facts from the repo, not memory. Planning happens here, in conversation; nothing is written to a plan file. `--plan` presents the plan and waits for approval (default off).

Then implement, following `docs/harness/engineering.md` and the technical design; use available framework skills for specifics, falling back to repository patterns and official framework documentation. Schema changes generate their migration (`pnpm db:generate`) in the same commit.

**UI pre-flight.** Before the first diff to a component or page, check the surface at phone width first (FR-9.4) and build from existing shadcn primitives and theme tokens — a surface that hand-rolls what `src/components/ui` already provides is the review finding.

## 3. Test & review

**Tests land with the behavior:** new or changed behavior gets an automated test at the cheapest layer that can pin it — Vitest for `src/lib` and server actions, Playwright e2e for a critical user flow (ADR-0003; one representative case per rule through actions/e2e, the exhaustive matrix in lib).

Then: `pnpm typecheck && pnpm lint && pnpm test` scoped to what you touched. **The full gate stack (`pnpm build`, `pnpm test:e2e`) runs once, after review fixes settle, before pushing** — during fix loops run only the tests scoped to the fix, because a full suite re-run per fix multiplies minutes-long suites by the number of findings and proves nothing the final pass won't. e2e shares the dev database on :5434, so it runs one session at a time.

Demonstrate by hand **only what no automated layer pins** — visual layout, a new UI surface, third-party behavior; mechanics in `/verify`. A flow an e2e test already asserts needs no live drive on top: the second proof costs real minutes and can only agree with the first.

Documentation-only harness changes: validate skills, reference targets, rule preservation, and formatting; application build/e2e gates apply only when there is a runtime surface. Never claim an unrun check passed.

Review by risk:

- **Risk-gated independent review:** if the diff touches auth/ownership gating (`canPerformAction`, ownership scoping in actions), `visiblePostsWhere()` or any public-read predicate, comment moderation / rate limiting, or a migration, dispatch an independent reviewer in fresh context following `docs/harness/evaluator.md` briefed with the diff, the plan, the acceptance criteria, and two standing checks: **the session → role → ownership order** on every mutation touched, and **cache revalidation** (every mutation that changes a public read calls the right `revalidateTag`). **The loop is bounded at two rounds:** one full hunt, then one re-verify through the host follow-up facility (or a separate review session with the original findings and fix diff) scoped to the fixes. A non-blocker finding the re-verify surfaces gets recorded in the PR's Human-review section, not a third round — an unbounded loop converges on verification churn, not on new bugs (the real finds come from the first hunt). Rejected findings get a recorded rationale.
- If independent review is required but unavailable, prepare a separate-session or human handoff and leave the review pending. Self-review never satisfies this gate. Do not mark the task complete or proceed to Share until required independent review is completed and blockers are resolved. Unresolved blockers prevent a safe-to-commit verdict.
- **Everything else:** self-review the full diff against the plan and `docs/harness/engineering.md`. Bug review and simplification review (reuse, dedup, abstraction level) are available on demand, using host review capabilities or explicit separate passes; run both over the full diff for epic-scale work or any run of 3+ tasks, where cross-task duplication accumulates.
- In `--test=manual`, describe what to test and wait for the result. `--test=skip` only when there is no runtime surface.

## 4. Share

Docs updated if behavior or architecture changed, non-obvious decisions recorded via `/adr`, task marked `[x]`. Commit to the feature branch (conventional-prefix messages, logically grouped), push, and open a PR targeting `staging` with `gh pr create` — summary, task IDs, test and review outcomes. **Keep the body compact:** a paragraph of what shipped, a checklist of gates and review outcomes, then the Human-review section — which is the one part written in full, since it's the part only the human can act on. Narrative that restates the diff costs minutes to write and the reviewer reads the diff anyway.

**The PR body ends with a `## Human review` section** — three subsections, each written even when the answer is "none":

- **Decisions made without asking** — choices the docs didn't settle, one-line rationale each.
- **Judgment surfaces** — UX, layout, copy, and visual choices automation can't validate.
- **Not provable by automation** — anything whose proof needs prod config, a real AI Gateway key (moderation fails closed locally), OAuth, or eyes on a phone-width screen.

Then report: what shipped, review and test outcomes, docs/ADRs touched, the PR link, the Human-review section mirrored verbatim, and the next unblocked task. Pushing a feature branch needs no confirmation; never push to `staging`/`main` directly.

## Escalate — in every mode

Stop and ask when:

- a change would **deviate from `docs/technical-design.md`** (locked at v0.3) — propose the deviation and an ADR before coding it;
- a **product or scope question** isn't settled by the product doc, design doc, or task, and a wrong guess means real rework (choices with a sensible default: pick it, note it, move on);
- **prerequisites are missing** — credentials, env vars, an unmet `deps:` task;
- you're **not progressing** — ~3 review/test fix loops on the same issue; report what you tried;
- the task is **materially bigger** than its one-line scope implies — propose a split.

Make the ask the headline, give your recommendation, and wait.
