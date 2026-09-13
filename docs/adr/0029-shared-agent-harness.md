# 0029. Shared agent harness with host adapters

- **Status:** Accepted
- **Date:** 2026-09-08
- **Related:** [AGENTS.md](../../AGENTS.md), [harness](../harness/README.md), technical-design.md §7, backlog/README.md

## Context

Paulitakes' instructions, workflows, and reviewer contract lived under Claude-specific entry points. Codex needs the same rules without duplicating policy or importing Picks Leagues' product assumptions. Existing instructions also conflicted: worktree setup copied live environment files despite the root prohibition, the root described protected-branch pushes as promptable despite the no-direct-push rule, and workflow npm recipes lagged the declared pnpm package manager.

## Decision

Use root `AGENTS.md` for shared entry and `docs/harness/` for authoritative engineering rules, seven workflows, and independent reviewer instructions. Keep Claude imports, skills, and evaluator as thin adapters, and add native Codex skills under `.agents/skills/`. Replace the evaluator model pin and proprietary workflow tool requirements with capability descriptions and explicit fallbacks; preserve mandatory independent review, its risk triggers, and its two-round bound.

Retain Paulitakes' staging-based feature branches and staging-targeted PRs, default `feat/` naming with explicit user/host naming overrides, local backlog and its Priority override, locked design, and editorial vision. The secret-file prohibition wins: humans provision worktree environment files; agents do not copy them or manually extract signing secrets/cookies. Existing tests may consume human-provisioned environment values without exposing them. Establish a migration target without reading secrets or ask a human first. Protected branches accept changes through PRs, with human-only merges. Use pnpm as declared in package.json. Explicit user limits override workflow commit/push/PR defaults; harness-only edits use documentation validation rather than application runtime gates.

## Consequences

Shared changes have one maintenance location; historical ADR paths remain valid through adapters. Claude permissions and hook code remain unchanged and Claude-only. Codex receives shared safety instructions, not an equivalent command hook; native host enforcement must be configured separately if required. Missing review or browser capabilities remain explicit pending checks rather than silently weaker proof. No application behavior, product moderation model, live secrets, or global agent configuration changes. The locked application design needs no amendment.
