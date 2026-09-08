# Repository agent harness

[AGENTS.md](../../AGENTS.md) is the shared entry point. [Engineering rules](engineering.md), [workflows](workflows/), and the [independent evaluator](evaluator.md) have one authoritative copy here. Maintain host adapters as pointers, not copies of policy.

## Invocation and capabilities

Codex skills live in `.agents/skills/<name>/SKILL.md`: invoke `$task`, `$backlog`, `$feedback`, `$ask`, `$adr`, `$verify`, or `$worktree` with the request arguments. Claude's existing slash commands route to the same workflows. Start a fresh session if newly added skills are not discovered. Other hosts can read the shared workflow directly.

Repository reads/search and a shell suffice for most work. Use available browser control for visual or interactive checks; if unavailable, request a human check and record it as pending. Framework skills are optional; use repository patterns and official documentation as fallback. No harness model pin is required. The product's moderation model choice remains unchanged.

Independent review requires a fresh context with the diff, plan, acceptance criteria, and evaluator contract. Use the host's independent-agent capability, a separate session, or a human reviewer. Self-review does not satisfy a mandatory independent review. The task workflow retains its risk triggers, two-round limit, and blocker handling.

## Enforcement boundaries

Shared safety instructions apply in every host, but are not command interception. `.claude/settings.json` retains Claude permission denies and the worktree-removal ask; `.claude/hooks/guard-destructive.sh` retains its Bash PreToolUse prompts for protected-branch pushes, production Vercel operations, and remote migrations. **These settings and hooks do not run in Codex.** Claude permission precedence is deny over ask over allow; prompt-suppressing modes may bypass an ask but not a deny or enforcement hook.

The unchanged hook is heuristic, not a shell parser or proof that an operation is safe. Its existing migration-target check can inspect environment files internally; that is host-specific implementation, not permission for agents to inspect or copy live secrets. It may miss indirect commands or mixed local/remote targets. Follow the shared target-confirmation rule regardless of whether a hook prompts. Treat a prompt as a stop, not a formality.

Other hosts use their own permission/sandbox mechanisms; this migration installs no global configuration or equivalent Codex hook. Git hooks, CI, and remote branch protections are separate layers. If command-level enforcement is required in another host, have the human configure and verify it before granting access to shared environments. Never bypass or weaken existing enforcement.

## Maintenance and validation

Keep both sets of skill adapters, `CLAUDE.md`, `.claude/rules/engineering.md`, and `.claude/agents/evaluator.md` thin. Historical merged ADRs retain their original paths, which still resolve through adapters. Active navigation points to shared instructions.

For harness-only changes, validate every skill's name/description, reference targets, preservation of rules, and Markdown formatting; run `git diff --check`. Application changes still require the task workflow's runtime checks. Check read-only discovery in a fresh host session before relying on new adapters; static validation cannot prove host discovery or enforcement.

See [ADR-0029](../adr/0029-shared-agent-harness.md) for the migration and conflict resolutions.
