# 0030. AI review and safe editor versions

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** FR-7.11–7.13; technical-design.md §4, §5.7, §8; AIR-1–6

## Context

Paul approved request-only AI editorial review before broader collaboration. Existing staged-draft timestamps protect races inside a request, but do not identify the version a browser originally loaded. A stale autosave could overwrite a human edit or an accepted AI proposal. Full revision history remains unimplemented.

## Decision

Ship the safe-save foundation in AIR-2, before proposals. Add an opaque UUID `posts.edit_version`, generated at creation and replaced on each editorial/lifecycle/ownership write and staged-buffer mutation. Every editor update requires the loaded token; compare it under the post lock with the write. Return the new token with successful saves; reject stale no-ops too. Recheck the direct/staged destination against actual visibility under the lock. Ownership/lifecycle writes invalidate the token, including transfer, promote and discard. Versions describe mutable state, not append-only history. Conflicts stop autosave and preserve the complete unsaved form, with labeled Markdown copy/download (metadata plus unmodified article Markdown) and deliberate reload; never silently retry on a new version. The comment-lock toggle explicitly preserves the current token: moderation state is outside the editorial snapshot and must not force saving or losing unsaved writing. Successful status/schedule changes reload content and token together, retaining the unsaved-change warning for late keystrokes.

All authors' saved drafts and public posts are eligible for AI review without per-post opt-in. Agents may suggest title, slug, body, images, video, category and tags; immutable proposals retain base/candidate snapshots, the same edit-version token, complete server-generated diffs, notes and agent/skill attribution. One open AI proposal per post; closed history retained until post deletion. Only humans select/apply changes. Public-post application writes a private staged snapshot; publication remains separate. Stale proposals require a fresh review. Later human collaboration reuses versions, proposal/diff/apply primitives and post-scoped permissions; it does not inherit the agent's site-wide access.

Local Codex comes first: a command-line helper over an isolated scoped REST API ([ADR-0035](0035-command-line-editor-client.md) supersedes the original local MCP adapter choice). The dedicated Paulitakes Editor skill is explicitly loaded by the review workflow; clean content, complete visible edits, and sourced editorial/fact-check/media notes map to the proposal contract. Preserve each contributor's voice. Keep skill identity/hash for traceability, not as proof of factual accuracy. Use Picksleagues' fail-closed separate bearer-auth and sanitized-audit patterns, adapted to scoped proposal creation, hashed persisted credentials and revocation/expiry. No human session or direct DB access for agents. Proposal creation is the sole planned exception to the server-action mutation rule; all post/lifecycle changes remain human server actions.

## AIR-3 implementation decisions

- Store full base/candidate snapshots, complete diff v1 and separate editorial/fact/media notes in `edit_proposals`. Keep status and accepted/rejected IDs, actor and applied version as decision fields; application never edits the original proposal content. Post deletion cascades this history; account deletion nulls the deciding-user reference.
- Use [jsdiff](https://github.com/kpdecker/jsdiff) for exact line changes (no whitespace/newline normalization), bounded to 1,000 edits/50ms. If the budget is exceeded, show one complete body replacement. Stable change IDs are scoped to the immutable proposal. Metadata is selected by whole field. All selected changes must reconstruct the complete candidate; partial selections are validated again as a whole snapshot.
- Lock the post before proposal reads/writes. An explicit superseded proposal ID is required to replace an open proposal; record its closed status and retain its snapshots. Note-only proposals can be read and rejected without inventing prose changes.
- Application uses the proposal's source UUID and original public state, rechecks wall-clock visibility before writing, and records the human decision in the same transaction. For a timed archive with a still-present buffer, direct application consumes that buffer with the selected complete snapshot rather than leaving stale text for the editor to overlay.
- Publish/discard now compare their request-loaded UUID under the lock too. Millisecond timestamps and unconditional discard cannot safely protect an in-flight request from a concurrently applied proposal. These operations still require an explicit human action; no new publishing route is added.
- This slice provides the server-only submission service and owner/admin read/apply/reject actions. AIR-4 adds the human review page; agent authentication/transport remain AIR-5–6. No API accepts an agent identity supplied in the proposal payload; the later auth boundary supplies the trusted principal.

## Consequences

AIR-2 adds one column and deliberately conflicts on lifecycle/ownership changes as well as prose changes. All staged writes must bump the parent token in the same transaction; direct SQL maintenance must also invalidate it. Stale clients cannot recover by resubmitting without an expected version. Rich comparison/merge, collaborator grants and revision history remain later work. AIR-3 delivers proposal storage, comparison and guarded decisions; AIR-4 delivers the human review UI; AIR-5–6 deliver agent integration. The feature is not usable end-to-end until those later slices land.
