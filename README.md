# Paulitakes

Sports analysis. Stories. Cheap laughs.

A mobile-first sports blog from Paul and guest authors, mixing analysis,
storytelling, and humor. Taking sports seriously, and ourselves a little less so.

Next.js App Router · TypeScript · Tailwind +
shadcn/ui · Drizzle · Neon Postgres (Docker locally) · Better Auth.

Docs: vision in [`docs/vision.md`](docs/vision.md), product spec in [`docs/product-doc.md`](docs/product-doc.md), locked
architecture in [`docs/technical-design.md`](docs/technical-design.md),
decisions in [`docs/adr/`](docs/adr/), work backlog in
[`backlog/`](backlog/).

## Agent workflows

Start with [AGENTS.md](AGENTS.md) and the [shared harness](docs/harness/README.md). Codex `$task`, `$backlog`, `$feedback`, `$ask`, `$adr`, `$verify`, and `$worktree` use the same workflows as Claude’s slash commands.

## Local development

```bash
pnpm install
cp .env.example .env          # fill in BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm db:up                    # Docker Postgres 18 on localhost:5434
pnpm db:migrate
pnpm dev
```

Local Google/Discord OAuth clients are required (env validation enforces
them) — see [`docs/runbooks/environments.md`](docs/runbooks/environments.md).

## Scripts

| Command                           | What it does                                  |
| --------------------------------- | --------------------------------------------- |
| `pnpm dev` / `build` / `start`    | Next.js dev / production build / serve        |
| `pnpm lint` / `typecheck`         | ESLint / `tsc --noEmit`                       |
| `pnpm format` / `format:check`    | Prettier write / check                        |
| `pnpm test` / `test:watch`        | Vitest unit tests                             |
| `pnpm test:e2e`                   | Playwright e2e (starts the dev server itself) |
| `pnpm db:up` / `db:down`          | Start / stop local Postgres                   |
| `pnpm db:generate` / `db:migrate` | Create / apply drizzle migrations             |
| `pnpm db:studio`                  | Drizzle Studio                                |
| `pnpm db:promote-admin <email>`   | One-time first-admin bootstrap                |

## Environments

Local → staging (`staging` branch, Neon `staging`) → prod (`main`, Neon
`main`), deployed on Vercel. CI runs lint/typecheck/tests/migrations on
every PR; pushes to `staging`/`main` apply migrations to the matching Neon
branch. Setup runbook: [`docs/runbooks/environments.md`](docs/runbooks/environments.md).
