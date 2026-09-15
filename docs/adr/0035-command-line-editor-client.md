# 0035. Command-line editor client

- **Status:** Accepted
- **Date:** 2026-09-15
- **Related:** AIR-6, FR-7.12–7.13, technical-design.md §4; supersedes [0034](0034-local-editor-mcp.md) and the MCP transport choice in [0030](0030-ai-review-and-safe-editor-versions.md)

## Context

Paul approved simplifying the local integration to match the direct API approach used in Picksleagues. MCP's named tools are optional convenience for this single local workflow; the REST API already enforces authorization, retries and human-only content changes.

## Decision

Replace the MCP adapter and SDK dependencies with a one-shot Node command-line helper: brief, list, read and submit. Keep fixed origin/token/skill-path environment configuration, shared schema validation, redirect refusal and sanitized failures. JSON proposal input arrives on stdin, never in command arguments. The explicit review workflow loads the complete installed editorial brief before reviewing; brief also supplies a fresh UUID retry key. Submission rereads the installed brief and checks the caller's expected skill hash before attaching authoritative name/hash attribution. Retry the same saved submission input.

## Consequences

No MCP registration or background process. The stateless helper does not track call order or prove skill compliance; the skill workflow requires explicit reading before each review. A changed brief blocks submission until reassessed; an uncertain retry must retain its original input and brief rather than silently acquiring new attribution. The existing REST API, human review/apply/publication and collaboration foundation are unchanged. Setup still requires the existing agent token and local skill file; no extra credentials are introduced.
