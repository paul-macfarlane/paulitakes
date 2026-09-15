# 0031. Scoped agent API and retry receipts

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** FR-7.13, technical-design.md §3, AIR-5; extends [0030](0030-ai-review-and-safe-editor-versions.md)

## Context

Local Codex needs review content and proposal submission without acquiring a human session or publication authority. Retries must not create duplicate proposals or silently replace another review. Picksleagues provides the independent bearer, constant-time digest comparison, private responses and fixed audit metadata patterns; its credentials are not shared.

## Decision

Expose three versioned REST operations using separate persisted credentials with `content:read` and `proposals:create` scopes. Store only SHA-256 digests of random 256-bit tokens, plus expiry and revocation. Provision through an operator CLI with its own data layer; never expose credential management over the agent API. Content-read explicitly covers all authors' effective drafts, with no account or activity data.

Use durable per-credential 60-second windows: 60 reads and 6 submissions. Commit admission before streaming a request, then recheck credentials under lock during the operation and before commit. Bound JSON request/response bodies to 1 MiB and body reading to 10 seconds. No database transaction spans request streaming. These defaults can be revisited from sanitized operational evidence.

Require a UUID idempotency key for submission. Store the validated payload digest and proposal receipt atomically with proposal creation/supersession. Same credential/key/payload returns the original proposal, even after human closure or source changes. A different payload conflicts; deleting the proposal leaves a receipt tombstone. Credential deletion removes its receipts. Lock credentials before posts, and roll back the whole write if expiry or receipt persistence fails.

## Consequences

AIR-6 can remain a thin adapter over the shared proposal contract. Review reads and creation never change post content, versions or public caches; humans still apply and publish through existing guards. Operators must provision/revoke credentials privately and deploy the additive migration before enabling clients. Fixed-window quotas allow boundary bursts and do not replace infrastructure protection against unauthenticated traffic. Receipts retain opaque IDs/digests until credential deletion; they contain no article text.
