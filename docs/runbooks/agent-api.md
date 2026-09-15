# Agent editorial review API

AIR-5 supplies the server boundary. AIR-6 supplies the local Codex adapter and explicit Paulitakes Editor skill workflow. Agent reviews are requested by a human; the API does not run a model or schedule reviews. See [ADR-0031](../adr/0031-scoped-agent-api-and-retry-receipts.md).

## Operator setup

Deploy migration `0017_high_tiger_shark.sql` through the normal approved database process before enabling a client. Only local migration has been verified during implementation. A human must establish the database target and provision `DATABASE_URL` out of band; never paste credentials into chats, Notion, source control or review artifacts.

Run the following against the intended database, replacing the label and expiry as appropriate:

```sh
pnpm agent:credentials issue 'Local Codex editorial review' 90 'content:read,proposals:create'
pnpm agent:credentials list
pnpm agent:credentials revoke <credential-uuid>
```

Issue accepts 1–365 days and one or both scopes. It writes only a token digest and prints the secret once after a successful insert. Store that output privately in the client's credential configuration. List prints only non-secret credential metadata. Revocation blocks subsequent admission/use; an operation already holding the credential lock may complete before revocation commits. Rotation means issuing a replacement and revoking the old credential. The API has no credential-management endpoint. Do not issue a real credential merely to test this implementation; tests create and remove synthetic credentials against local Postgres.

## HTTP contract

Use HTTPS outside localhost. Send `Authorization: Bearer <token>` on every operation. Cookies and human sessions do not authorize agent access. All responses are private/no-store and include a server-generated `X-Request-Id`.

| Operation                                        | Scope              | Result                                                                                             |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /api/agent/v1/drafts?limit=20&after=<uuid>` | `content:read`     | `{items: [{id,title,status,sourceVersion}], nextCursor}`; UUID order, max 50, cursor nullable      |
| `GET /api/agent/v1/drafts/<uuid>`                | `content:read`     | `{id,sourceVersion,snapshot,sourceIsPublic,context,openProposalId,categories,categoriesTruncated}` |
| `POST /api/agent/v1/edit-proposals`              | `proposals:create` | 201 `{id,postId,reviewPath,replayed:false}`; successful retry 200 with `replayed:true`             |

Draft reads include all authors' saved posts. `snapshot` is the effective editable content: a staged draft when present for a published or scheduled lifecycle status (including a timed archive awaiting status normalization), otherwise its current content. Its fields are `title`, `slug`, `bodyMd`, `categoryId`, `tags`, `thumbnailUrl`, `bannerUrl`, and `videoUrl`. Context contains lifecycle `status`, `publishAt`, and `archiveAt` only. Category choices contain IDs/names, up to 100 active categories plus the current category within that limit (current first). No account, author identity, session, comment or analytics payload is returned. Reading never creates a staged draft or changes its version.

POST requires `Content-Type: application/json` (optional UTF-8 charset), no compression, and a UUID `Idempotency-Key`. Its strict body is defined by [submitProposalSchema](../../src/lib/proposals/input.ts). Send `postId`, the exact `sourceVersion` returned by read, a complete `candidate` snapshot, `skill` attribution and structured `notes`; include `supersedesProposalId` only when explicitly replacing the current open proposal. Omitted optional fields follow the shared schema; unknown fields are rejected. The server derives agent identity from the credential and computes the immutable base/diff. It does not trust client-supplied ownership, lifecycle or publication fields.

Keep the same key and body when retrying an uncertain submission. The receipt compares the validated canonical payload, independent of object-key order. A new editorial request gets a new key. Reusing a key with a different payload returns 409. A successful retry returns the original proposal even if it has since been applied/rejected/superseded or the source changed. If its proposal was deleted, retry returns 410; do not silently recreate it. Failed attempts do not reserve a key.

There is one open proposal per post across all agents. A source change or an unexpected open proposal returns 409; reread and obtain a new review decision rather than blindly superseding. The review path requires a human owner/admin session. Applying public-post changes stages them privately; publication remains a separate human action. There are no agent apply, publish, lifecycle, direct-edit or delete operations.

## Limits and failures

Per credential: 60 reads and 6 submissions per fixed 60-second window, persisted across instances. Authenticated invalid requests and retries consume quota; 429 includes `Retry-After` seconds. Invalid/inactive credentials return 401, insufficient scope 403, invalid contract 400, absent source 404, unsupported method 405, slow body 408, oversized body 413, unsupported encoding/type 415. Errors use `{error: code, message, requestId}`; unexpected failures and oversized stored responses return sanitized 503. JSON requests and responses are capped at 1 MiB; body streaming has a 10-second deadline. No database transaction is held while receiving the body.

Application audit emits only the fixed operation, outcome, timestamp, server request UUID and verified/resolved credential/post/proposal IDs. It never emits bearer tokens, request headers/URLs, article text, notes, payload hashes or raw exception messages. Hosting/proxy logging is separately configured by the operator; do not enable request-header/body capture. Per-credential limits do not provide unauthenticated volumetric protection.
