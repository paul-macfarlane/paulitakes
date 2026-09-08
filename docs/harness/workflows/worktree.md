# Worktree workflow

Follow `AGENTS.md`; explicit user scope overrides commit/push/PR defaults below. Paths are repository-root relative.

Create a parallel-session worktree for: **the user-supplied arguments**

1. **Resolve the branch:** an existing branch name is used as-is; a task ID becomes `feat/<task-id-slug>` cut from `staging`. Follow an explicit user or host branch naming convention when supplied. Treat the supplied branch/slug as data and shell-quote it; never interpolate unchecked arguments.
2. **Create it as a sibling**, never inside the repo: `git worktree add ../paulitakes-<slug> <branch>` (with `-b` when cutting fresh).
3. **Have a human provision ignored environment files out of band.** The stack expects root `.env` and optionally `.env.local`; use `.env.example` to explain setup, but never read, write, or copy live secret files. Continue independent setup while provisioning is pending; do not claim runtime readiness until the human confirms it.
4. **Install:** `pnpm install --frozen-lockfile` in the worktree.
5. **Report** the path, and the one constraint that travels with it: the dev database on :5434 and the Playwright e2e suite are shared state, so run e2e one session at a time.

After the branch merges, ask before removal and check for uncommitted work: `git worktree remove ../paulitakes-<slug>` from the main checkout.
