# Epic: Foundation (FND)

Scaffold the app and get environments + auth settled early so OAuth redirect URIs are stable. Ref: technical-design.md §7, §9.1.

- [x] **FND-1** — Scaffold Next.js App Router + TypeScript + Tailwind; base project structure per technical-design.md §6. _(deps: none)_
- [x] **FND-2** — Add shadcn/ui and configure theme/tokens. _(deps: FND-1)_
- [x] **FND-3** — Drizzle + local Docker Postgres (compose file matching Neon major version); drizzle-kit config + migration workflow. _(deps: FND-1)_
- [x] **FND-4** — Better Auth: Google + Discord OAuth, Drizzle adapter; extend `user` with `role` (reader/author/admin, default reader) and `banned_at`. _(deps: FND-3)_
- [x] **FND-5** — Typed env validation (zod) + `.env.example` covering all vars in technical-design.md §7. _(deps: FND-1)_
- [x] **FND-6** — Vercel project; staging + prod environments; Neon `staging`/`main` branches; per-env OAuth clients with registered redirect URIs. _(deps: FND-4)_ — Vercel project + GitHub connection automated; Neon branches, OAuth clients, GitHub secrets, and Vercel env vars provisioned manually 2026-07-05. Reference: `docs/runbooks/environments.md`.
- [x] **FND-7** — One-time seed script to promote the first admin (no in-app self-promote path). _(deps: FND-4)_
- [x] **FND-8** — CI: run drizzle migrations (staging→prod) + typecheck + lint + **tests** on PR. _(deps: FND-3, FND-6, FND-10)_
- [x] **FND-9** — Safety hook prompting on destructive commands (`git push`, Vercel prod deploys, `drizzle-kit push`/migrate against a non-local DB). Done as harness setup: `.claude/hooks/guard-destructive.sh` + `PreToolUse` in `.claude/settings.json`. _(deps: none)_
- [x] **FND-10** — Test harness: **Vitest** (unit/integration for `src/lib` + server actions) + **Playwright** (e2e for critical flows). Config, `test`/`test:e2e` scripts, and a first smoke test. See ADR-0003. _(deps: FND-1)_
- [x] **FND-11** — Auth UI: sign-in page/buttons (Google, Discord), session menu with sign-out, editable display name (FR-10.1, FR-10.2). _(deps: FND-4)_
- [ ] **FND-12** — Stop unhandled Neon WebSocket errors in prod. Since ~2026-10-09, production logs show repeated `Error: Unhandled error. ()` on post and tag pages (e.g. `/posts/jets-week-5-reaction-beggars-can-t-be-choosers`, `/tags/jaguars`), stack `idleListener → _handleErrorEvent → reportStreamError → WebSocket`. Likely the Neon serverless Pool (prod only; local uses `pg`) emitting `error` from an idle client with no `pool.on('error')` listener. Confirm the cause in `src/db`, check whether those requests actually failed, and log idle-client errors with context without masking real query errors. [Notion task](https://app.notion.com/p/3f7c4dbb621781b1b9b6f323eef7f786). _(deps: none)_
