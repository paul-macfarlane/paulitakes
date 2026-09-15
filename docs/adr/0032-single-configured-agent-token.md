# 0032. Single configured agent token

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** FR-7.13, technical-design.md §3, AIR-5; supersedes credential management in [0031](0031-scoped-agent-api-and-retry-receipts.md)

## Context

Paul requested the simpler Picksleagues-style setup after reviewing PR #41. A database of individually scoped, expiring credentials and its provisioning CLI add unnecessary maintenance for one trusted editorial client. Proposal creation still requires bounded requests, quotas, stale-source checks and atomic retry handling.

## Decision

Configure one dedicated `AGENT_API_TOKEN` per environment on the server and client. Accept a strict bearer token using constant-time SHA-256 digest comparison. Missing/malformed configuration and reuse of the human-auth or cron secret fail closed. Fixed capability boundaries permit only review-content reads and proposal creation. There is no credential issuance CLI, database credential storage, per-client scope selection or automatic expiry. Replacing/removing the token and restarting/redeploying the server revokes old access once that configuration takes effect; existing instances/in-flight requests may finish beforehand.

Use one stable server-owned principal for attribution, durable read/write quotas and retry receipts. Never derive that identity from the token: rotation must preserve quota and successful request identity. Keep the existing 60 reads/6 submissions per minute, 1 MiB limits, 10-second body deadline, sanitized audit and human-only apply/publication. An automatically initialized `agent_api_state` row contains counters only. Receipts retain opaque IDs/digests, including deletion tombstones, without a timed cleanup job.

## Consequences

Setup is one environment secret copied into the client, with rotation only when needed. Clients sharing the token also share permissions, attribution and quotas; individual revocation would require revisiting this decision. Environment configuration is loaded at process startup, so secret changes must reach every serving instance. Migration 0018 removes the obsolete credential table but retains existing proposal/receipt records; pre-simplification receipts retain their old opaque namespace and do not become retries under the new principal. No live deployment or credential issuance is part of this change.
