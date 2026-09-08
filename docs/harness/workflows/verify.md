# Verify workflow

Follow `AGENTS.md`; explicit user scope overrides commit/push/PR defaults below. Paths are repository-root relative.

# Verifying paulitakes changes at runtime

## Launch

- DB: `docker compose ps` — container `paulitakes-db`, host port **5434**. Start with `pnpm db:up`; apply pending migrations with `pnpm db:migrate` only after establishing the target is local without inspecting secrets; otherwise ask a human to establish the target first.
- App: `pnpm dev` (background), ready when `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` returns 200 (~5-15s).

## Drive

- **Public pages** are server-rendered — `curl` the route and grep the HTML; that IS the surface. Post pages: `/posts/{slug}`.
- **DB state setup** without going through the UI:
  `docker exec paulitakes-db psql -U paulitakes -d paulitakes -c "<sql>"`
  Reset any synthetic rows/values afterward — this is Paul's live dev data.
- **Caching gotcha:** public pages are `"use cache"` with `cacheLife({ stale: 60 })` even in dev. DB edits made _after_ a page was first served may not appear for up to 60s; set DB state **before** first request, or use a different slug per state.

## Auth-gated flows (`/admin/**`)

Drivable headlessly despite OAuth-only sign-in: `e2e/helpers/session.ts` mints a real signed session WITHOUT OAuth (inserts user + session rows, HMAC-signs the `better-auth.session_token` cookie with `BETTER_AUTH_SECRET` from `.env`). Use it through Playwright:

- **Playwright** (preferred): specs in `e2e/` call `createTestSession({ role: "author" | "admin" })` and `context.addCookies([session.cookie])`. `pnpm exec playwright test <spec> -g "<title>"` — the config's `webServer` auto-starts the dev server. Helpers also seed categories/posts/users directly.
  Do not manually read secrets, mint/display cookies, or reconstruct credentials for curl. Use the existing local test helper through Playwright; application/test processes may consume human-provisioned environment values without exposing them to the agent. If unavailable, request human provisioning and report the verification as pending.

Always call the helper's `cleanup()` — seeded rows live in Paul's dev DB.

## Gotchas

- Expected local database: Docker Postgres on localhost:5434; `.env.example` documents configuration. Do not inspect live environment files to verify it.
- Seeded/dev slugs to reuse for read-only checks: `seeded-take-1`.
