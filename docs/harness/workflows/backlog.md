# Backlog workflow

Follow `AGENTS.md`; explicit user scope overrides commit/push/PR defaults below. Paths are repository-root relative.

Report backlog status, filtered by the user-supplied arguments if present. This workflow is read-only; do not edit backlog state.

- Read the epic files in `backlog/` (all of them, or just the one matching a prefix argument like `POST`).
- For each epic, show counts: done `[x]`, in-progress `[~]`, blocked `[!]`, todo `[ ]`.
- List in-progress and blocked items explicitly, with why they're blocked from `deps:`.
- Identify the **next runnable task** — the first `[ ]` in build order (`backlog/README.md`: Priority list first while open, then epic table) whose `deps:` are all `[x]`.
- Group the report by that same order, so the summary reads as the plan rather than as the filesystem.
- Keep it a scannable summary, not a dump of every task. End with: run `/task next` to start the next one.
