# 0030. AI review and safe editor versions

- **Status:** Accepted
- **Date:** 2026-09-14
- **Related:** FR-7.11–7.13; technical-design.md §4, §5.7, §8; AIR-1–6

## Context

Paul approved request-only AI editorial review before broader collaboration. Existing staged-draft timestamps protect races inside a request, but do not identify the version a browser originally loaded. A stale autosave could overwrite a human edit or an accepted AI proposal. Full revision history remains unimplemented.

## Decision

Ship the safe-save foundation in AIR-2, before proposals. Add an opaque UUID `posts.edit_version`, generated at creation and replaced on each editorial/lifecycle/ownership write and staged-buffer mutation. Every editor update requires the loaded token; compare it under the post lock with the write. Return the new token with successful saves; reject stale no-ops too. Recheck the direct/staged destination against actual visibility under the lock. Ownership/lifecycle writes invalidate the token, including transfer, promote and discard. Versions describe mutable state, not append-only history. Conflicts stop autosave and preserve the complete unsaved form, with a labeled Markdown download (metadata plus unmodified article Markdown) and deliberate reload; never silently retry on a new version. The comment-lock toggle explicitly preserves the current token: moderation state is outside the editorial snapshot and must not force saving or losing unsaved writing. Successful status/schedule changes reload content and token together, retaining the unsaved-change warning for late keystrokes.

All authors' saved drafts and public posts are eligible for AI review without per-post opt-in. Agents may suggest title, slug, body, images, video, category and tags; immutable proposals retain base/candidate snapshots, the same edit-version token, complete server-generated diffs, notes and agent/skill attribution. One open AI proposal per post; closed history retained until post deletion. Only humans select/apply changes. Public-post application writes a private staged snapshot; publication remains separate. Stale proposals require a fresh review. Later human collaboration reuses versions, proposal/diff/apply primitives and post-scoped permissions; it does not inherit the agent's site-wide access.

Local Codex comes first: a thin local MCP adapter over an isolated scoped REST API. The dedicated Paulitakes Editor skill is explicitly loaded by the review workflow; clean content, complete visible edits, and sourced editorial/fact-check/media notes map to the proposal contract. Preserve each contributor's voice. Keep skill identity/hash for traceability, not as proof of factual accuracy. Use Picksleagues' fail-closed separate bearer-auth and sanitized-audit patterns, adapted to scoped proposal creation, hashed persisted credentials and revocation/expiry. No human session or direct DB access for agents. Proposal creation is the sole planned exception to the server-action mutation rule; all post/lifecycle changes remain human server actions.

## Consequences

AIR-2 adds one column and deliberately conflicts on lifecycle/ownership changes as well as prose changes. All staged writes must bump the parent token in the same transaction; direct SQL maintenance must also invalidate it. Stale clients cannot recover by resubmitting without an expected version. Rich comparison/merge, collaborator grants and revision history remain later work. AIR-3–6 deliver proposals, review UI and agent integration; recording this decision does not imply those features are implemented.
