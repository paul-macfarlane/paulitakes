# ADR-0036: Explanations alongside shared review suggestions

- **Status:** Accepted
- **Date:** 2026-09-20
- **Related:** AIR-7, FR-7.12, technical-design.md §5.7 (updated)

## Context

Staging feedback requested a reason beside every suggested edit and consistent presentation for future human and AI reviewers.

## Decision

Store explanations and source URLs in the existing proposal notes JSON, keyed to change ID and exact before/after text. The server checks complete correspondence before replacing an open proposal. A local compare command generates targets using the shared diff implementation; the reviewer fills the reasons. Metadata values are JSON-encoded to preserve nulls and arrays. Matching text prevents a timeout or whole-body fallback from silently attaching a reason to a different change.

New CLI submissions require explanations. Omission remains supported at the API boundary for older clients and retained proposals; the UI explicitly says when a reason was not supplied. No migration or rewriting historical reviews is necessary.

Use Reviews as the shared section name and identify existing reviewers as AI. Human submission, discussion and permissions stay in the collaboration scope, reusing this suggestion-and-explanation format.

## Consequences

Authors see reasons and relevant sources beside their selections. Notes never become article content. Callers must regenerate targets when their candidate changes; mismatched targets fail validation rather than being guessed. Older clients can still submit without per-change reasons until their integrations are updated.
