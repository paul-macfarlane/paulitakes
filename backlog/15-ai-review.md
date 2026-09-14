# Epic: AI editorial review (AIR)

Request-only agent reviews using the Paulitakes Editor skill. AI proposes; humans selectively apply and publish. Owner-approved scope: [AI review](https://app.notion.com/p/3d7c4dbb621781cd91a6ee2360fb72ad), aligned with [later collaboration](https://app.notion.com/p/3dac4dbb6217802696aac7aa05c60fb8). See FR-7.11–7.13 and ADR-0030.

- [x] **AIR-1** — Record the agreed editorial, agent-auth, proposal and collaboration contracts in the product/design docs and ADR. _(deps: none)_
- [x] **AIR-2** — Safe concurrent saves on direct and staged drafts, opaque edit versions, conflict recovery preserving all unsaved fields, and two-editor regression coverage (FR-7.11). Includes the foundation formerly called COLLAB-1; collaboration reuses it. _(deps: AIR-1)_
- [x] **AIR-3** — Immutable proposal snapshots, metadata/body diffs, structured editorial notes and guarded selective apply; one open AI proposal per post (FR-7.12). _(deps: AIR-2)_
- [x] **AIR-4** — Mobile-first human review UI with per-change selection, full comparison/preview and separate fact-check/media notes (FR-7.12). _(deps: AIR-3)_
- [ ] **AIR-5** — Scoped, revocable agent API with isolated contract, bounded reads/writes, idempotency, rate limits and sanitized audit (FR-7.13). Reference Picksleagues authentication patterns; never reuse its credentials. _(deps: AIR-3)_
- [ ] **AIR-6** — Local Codex MCP adapter and explicit Paulitakes Editor skill workflow; end-to-end requested review and human-only apply/publication proof (FR-7.12–7.13). _(deps: AIR-4, AIR-5)_

AI review ships before broader collaboration. No dependency on the full REV history epic; later human proposals reuse these snapshots/diffs and may link historical revision IDs.
