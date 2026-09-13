# Ask workflow

Follow `AGENTS.md`; explicit user scope overrides commit/push/PR defaults below. Paths are repository-root relative.

Answer this question about the codebase/product: **the user-supplied arguments**

## Ground rules

- **Read-only.** This command investigates and answers; it never edits code, docs, or backlog. If the answer implies a change worth making, end with the concrete next step (a proposed backlog item, `/task`, or `/adr`) and stop.
- **Facts come from the repo, not memory.** Establish current behavior by reading the relevant code directly; when the question needs a genuinely broad survey (many call sites, several subsystems), use independent read-only survey agents when available, or survey sequentially otherwise. Every claim in the answer is anchored to file:line either way.
- **Check the spec, not just the code.** When the question is "what _should_ it do", also check `docs/product-doc.md` (FR-x.y), `docs/technical-design.md`, and `docs/adr/` — the answer may already be decided, and a recommendation that contradicts the locked design doc must say so explicitly.

## Answer shape

1. **Lead with the direct answer** to what was asked, in plain prose.
2. **Current behavior** — every claim anchored to file:line from what you read. Distinguish "does X" from "never does X" (absence you actually verified).
3. **Recommendation** (only if asked or the current behavior is a gap/bug) — what to do, why, and the cheapest version that satisfies the requirement. Cite the FR/design section it serves or note that it's unspecified.
4. **Next step** — if action is warranted: proposed backlog one-liner and which epic it belongs in, or "run `/task ...`", or "record via `/adr`". If no action is needed, say so.

Keep it a scannable answer, not a research dump — the survey is raw material, not the deliverable.
