# 0034. Local editor MCP

- **Status:** Accepted
- **Date:** 2026-09-15
- **Related:** AIR-6, FR-7.12–7.13, technical-design.md §4, [0032](0032-single-configured-agent-token.md)

## Context

Codex is the agreed first review client. The REST API and human review screen already enforce proposal, source-version and publication rules. The maintained Paulitakes Editor skill is installed locally and must be explicitly supplied for every requested review.

## Decision

Use the official MCP SDK for a local STDIO adapter with four tools: load the brief, list drafts, read a draft, submit a proposal. Configure the site origin, existing token and absolute skill path outside tool arguments. Require HTTPS except loopback; refuse redirects. Reuse the proposal input schema and attach the SHA-256 of the exact loaded brief bytes. Keep that brief in connection memory until reloaded; the explicit review workflow reloads it for every review. Preserve caller-generated UUID retry keys and let the REST API own authorization, quotas, concurrency and receipts.

## Consequences

No new auth layer, database connection or remote MCP deployment. Local installation and token provisioning are operator prerequisites. The workflow consumes one maintained editorial brief without copying it into the app. Attribution identifies what was loaded, not whether the model followed it. Editorial judgment and factual verification remain human-review surfaces. Human apply/publication and later collaboration continue using the existing shared services.
