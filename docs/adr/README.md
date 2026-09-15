# Architecture Decision Records

Short documents capturing a significant technical/architectural decision, its context, and consequences. New records use `template.md`, numbered sequentially (`NNNN-kebab-title.md`). Once merged, an ADR is immutable — supersede it with a new one rather than editing (link both ways).

Create one with `/adr <title>` or `$adr <title>` ([shared workflow](../harness/workflows/adr.md)) whenever a choice is non-obvious, hard to reverse, or contradicts an existing decision. If a decision changes `docs/technical-design.md`, update that doc too and reference the ADR.

## Index

| #                                                                    | Title                                                         | Status   |
| -------------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                        | Record architecture decisions                                 | Accepted |
| [0002](0002-baseline-stack.md)                                       | Baseline stack and architecture                               | Accepted |
| [0003](0003-testing-strategy.md)                                     | Testing strategy                                              | Accepted |
| [0004](0004-comments-locked-flag-on-posts.md)                        | `comments_locked` flag on posts                               | Accepted |
| [0005](0005-neon-websocket-driver.md)                                | Neon serverless websocket driver (not neon-http)              | Accepted |
| [0006](0006-shadcn-base-ui.md)                                       | shadcn/ui on Base UI primitives (base-nova style)             | Accepted |
| [0007](0007-react-hook-form.md)                                      | react-hook-form for form state                                | Accepted |
| [0008](0008-cache-components.md)                                     | Next 16 Cache Components for ISR + cache tags                 | Accepted |
| [0009](0009-admin-gate-in-request-path.md)                           | Admin gate: cookie proxy + `requireStaff()`                   | Accepted |
| [0010](0010-admin-post-list-server-rendered.md)                      | Admin post list server-rendered, URL-param filters            | Accepted |
| [0011](0011-staged-edits-for-public-posts.md)                        | Staged edits for public posts (draft-of-published)            | Accepted |
| [0012](0012-normalized-post-draft-table.md)                          | Normalize the staged-draft buffer into `post_drafts`          | Accepted |
| [0013](0013-thin-actions-domain-organized-lib.md)                    | Thin actions + domain-organized `src/lib` layering            | Accepted |
| [0014](0014-capability-map-authorization-const-object-value-sets.md) | Capability-map authorization, const-object value sets         | Accepted |
| [0015](0015-explicit-create-and-flush-before-lifecycle-actions.md)   | Explicit post creation + flush-before-lifecycle               | Accepted |
| [0016](0016-content-updated-at-display-column.md)                    | `content_updated_at` drives the public "Updated" date         | Accepted |
| [0017](0017-category-management-semantics.md)                        | Category slugs stable; deactivate-not-delete; seed            | Accepted |
| [0018](0018-unified-home-browse-search.md)                           | Home is the single browse/search surface (PPR)                | Accepted |
| [0019](0019-page-link-pagination.md)                                 | Page-link pagination everywhere; load-more removed            | Accepted |
| [0020](0020-comment-moderation-lifecycle-semantics.md)               | Comment edit re-moderation, delete + placeholder semantics    | Accepted |
| [0021](0021-likes-read-write-shape.md)                               | Likes: desired-state set actions, session-aware tree reads    | Accepted |
| [0022](0022-auto-ban-repeat-moderation-offenders.md)                 | Auto-ban repeat moderation offenders (live rejected count)    | Accepted |
| [0023](0023-announcements-rendering-read-shape.md)                   | Announcements: one markdown pipeline, expiry as read filter   | Accepted |
| [0024](0024-brand-temperature-tokens-condensed-heading.md)           | Brand: hot/cold temperature tokens + condensed heading font   | Accepted |
| [0025](0025-analytics-ingest-dashboard-decisions.md)                 | Analytics: set-null views FK, daily salt, drop-with-204       | Accepted |
| [0026](0026-account-deletion-anonymization.md)                       | Account deletion: uniform comment anonymization, refusals     | Accepted |
| [0027](0027-author-post-deletion-and-transfer.md)                    | Author post deletion, admin post transfer, narrowed refusal   | Accepted |
| [0028](0028-viewer-local-dates.md)                                   | Viewer-local dates via client island; same-day Updated hidden | Accepted |
| [0029](0029-shared-agent-harness.md)                                 | Shared agent harness with host adapters                       | Accepted |
| [0030](0030-ai-review-and-safe-editor-versions.md)                   | AI review and safe editor versions                            | Accepted |
| [0031](0031-scoped-agent-api-and-retry-receipts.md)                  | Scoped agent API and retry receipts                           | Accepted |
| [0032](0032-single-configured-agent-token.md)                        | Single configured agent token                                 | Accepted |
