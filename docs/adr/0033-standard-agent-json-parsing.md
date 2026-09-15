# 0033. Standard agent JSON parsing

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** AIR-5, FR-7.13; supersedes custom request-body handling in [0031](0031-scoped-agent-api-and-retry-receipts.md) and [0032](0032-single-configured-agent-token.md)

## Context

Paul requested ordinary JSON parsing plus schema validation after reviewing the custom bounded reader. At the current scale, maintaining a streaming byte counter and upload deadline is unnecessary for this authenticated review API.

## Decision

Use `request.json()` after authenticated quota admission, then the existing strict proposal schema. Map body-reading/JSON failures to sanitized 400 responses. Remove the bespoke 1 MiB request cap, 10-second upload timer, content-type/encoding checks and stream-management helper. Hosting limits handle request size and execution duration; provider rejections need not match the API's error envelope. Local execution has no equivalent custom cap or deadline.

Keep authentication, fixed capabilities, durable quotas, schema field bounds, the 1 MiB response cap, stale-source checks, atomic retry receipts, sanitized audit and human-only apply/publication. No transaction spans request reading. Picksleagues' reference agent API is GET-only and has no equivalent custom body reader to remove.

## Consequences

The input path uses the platform JSON parser with fewer moving parts. Request-wide size/time policy is now hosting-specific; schema validation happens after the body has been read into memory. Revisit application-level limits if deployment targets or actual usage warrant them.
