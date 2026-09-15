# Agent editorial review API

AIR-5 supplies the server boundary. AIR-6 supplies the local Codex adapter and explicit Paulitakes Editor skill workflow. Agent reviews are requested by a human; the API does not run a model or schedule reviews. See [ADR-0032](../adr/0032-single-configured-agent-token.md).

## Setup

1. Apply repository migrations through `0018_sticky_sister_grimm.sql` using the normal approved database process. Only local migration is verified here. Migration 0018 removes the superseded credential table while retaining proposals and receipts. No issuance command or database credential record is needed.
2. Privately generate a token with `openssl rand -hex 32`. Set it as `AGENT_API_TOKEN` in the server environment and the client's private configuration. Use a different token for each environment; never reuse the human-auth or cron secret.
3. Restart/redeploy the server so the configured value takes effect. AIR-6 will supply the local Codex client configuration instructions.

Do not paste the token into chats, Notion, source control or review artifacts. Leave it unset to disable agent access. To rotate, replace the server/client value and restart/redeploy; to revoke all access, remove the server value and restart/redeploy. All serving instances must pick up the change. Old instances and already-running requests may finish before then. There is no automatic expiration or routine renewal command.

Everyone using this token shares the same limited capabilities, attribution and quotas. The server stores no agent token or token hash in the database; its secret configuration holds the token. A stable server-owned principal preserves rate limits and retry receipts across rotation. The counter row initializes automatically. Receipts, including deletion tombstones, have no automatic cleanup; they contain opaque IDs/digests, not article text. Old receipts from the superseded credential scheme remain in their old namespace and cannot be retried using the new principal.

## Local browser tests

Playwright generates a synthetic token for an automatically started local server. When reusing an already running local server, launch the server and test runner with the same synthetic `AGENT_API_TOKEN`; do not use a production token. The test helper removes only its synthetic posts' receipts. Tests do not provision credentials or print tokens.

## HTTP contract

Use HTTPS outside localhost. Send `Authorization: Bearer <token>` on every operation. Cookies and human sessions do not authorize agent access. All responses are private/no-store and include a server-generated `X-Request-Id`.

| Operation                                        | Scope             | Result                                                                                             |
| ------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/agent/v1/drafts?limit=20&after=<uuid>` | Review reads      | `{items: [{id,title,status,sourceVersion}], nextCursor}`; UUID order, max 50, cursor nullable      |
| `GET /api/agent/v1/drafts/<uuid>`                | Review reads      | `{id,sourceVersion,snapshot,sourceIsPublic,context,openProposalId,categories,categoriesTruncated}` |
| `POST /api/agent/v1/edit-proposals`              | Proposal creation | 201 `{id,postId,reviewPath,replayed:false}`; successful retry 200 with `replayed:true`             |

Draft reads include all authors' saved posts. `snapshot` is the effective editable content: a staged draft when present for a published or scheduled lifecycle status (including a timed archive awaiting status normalization), otherwise its current content. Its fields are `title`, `slug`, `bodyMd`, `categoryId`, `tags`, `thumbnailUrl`, `bannerUrl`, and `videoUrl`. Context contains lifecycle `status`, `publishAt`, and `archiveAt` only. Category choices contain IDs/names, up to 100 active categories plus the current category within that limit (current first). No account, author identity, session, comment or analytics payload is returned. Reading never creates a staged draft or changes its version.

Send JSON with `Content-Type: application/json` and a UUID `Idempotency-Key` on POST. The handler uses ordinary `request.json()` parsing followed by strict schema validation. Its strict body is defined by [submitProposalSchema](../../src/lib/proposals/input.ts). Send `postId`, the exact `sourceVersion` returned by read, a complete `candidate` snapshot, `skill` attribution and structured `notes`; include `supersedesProposalId` only when explicitly replacing the current open proposal. Omitted optional fields follow the shared schema; unknown fields are rejected. The server supplies its fixed agent identity and computes the immutable base/diff. It does not trust client-supplied ownership, lifecycle or publication fields.

Keep the same key and body when retrying an uncertain submission. Receipts survive token rotation. The receipt compares the validated canonical payload, independent of object-key order. A new editorial request gets a new key. Reusing a key with a different payload returns 409. A successful retry returns the original proposal even if it has since been applied/rejected/superseded or the source changed. If its proposal was deleted, retry returns 410; do not silently recreate it. Failed attempts do not reserve a key.

There is one open proposal per post across all agents. A source change or an unexpected open proposal returns 409; reread and obtain a new review decision rather than blindly superseding. The review path requires a human owner/admin session. Applying public-post changes stages them privately; publication remains a separate human action. There are no agent apply, publish, lifecycle, direct-edit or delete operations.

## Limits and failures

Across the configured agent API: 60 reads and 6 submissions per fixed 60-second window, persisted across instances. Authenticated invalid requests and retries consume quota; 429 includes `Retry-After` seconds. Missing, invalid or disabled tokens return 401, invalid contract 400, absent source 404, unsupported method 405. Errors use `{error: code, message, requestId}`; unexpected failures and oversized stored responses return sanitized 503. Responses remain capped at 1 MiB. Request size and upload timing rely on hosting limits; there is no custom application upload cap or timer, including locally (ADR-0033). Hosting-level rejections may use the provider’s error format rather than this API’s JSON errors. No database transaction is held while receiving the body.

Application audit emits only the fixed operation, outcome, timestamp, server request UUID and server-owned principal and resolved post/proposal IDs. It never emits bearer tokens, request headers/URLs, article text, notes, payload hashes or raw exception messages. Hosting/proxy logging is separately configured by the operator; do not enable request-header/body capture. Authenticated API limits do not provide unauthenticated volumetric protection.
