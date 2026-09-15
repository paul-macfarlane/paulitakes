# Paulitakes — Technical Design

**Version:** 0.3 (Locked; amended by ADR-0004; §6 project layout updated per ADR-0013; §5.7 authorization vocabulary per ADR-0014; §5.7 editor create/flush semantics per ADR-0015; posts data model `content_updated_at` per ADR-0016; §2/§3/§5.5 unified home browse/search per ADR-0018; §2 page-link pagination per ADR-0019; §5.2/§5.3 comment edit re-moderation + generalized placeholder rule per ADR-0020; §4/§5.7/§5.9 author post deletion + admin post transfer + narrowed account-deletion refusal per ADR-0027; §2 viewer-local date rendering + same-day "Updated" suppression per ADR-0028)
**Owner:** Paul
**Last updated:** July 15, 2026
**Companion doc:** Paulitakes Product Doc v0.2

---

## 1. Stack Summary

| Concern     | Choice                                                        | Notes                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework   | **Next.js (App Router)**                                      | SSR/ISR for public pages, server actions for mutations                                                                                                                       |
| Hosting     | **Vercel**                                                    | Image handling, AI Gateway                                                                                                                                                   |
| Scheduler   | **Vercel Cron**                                               | Daily hit of the secret-protected endpoint (`vercel.json`). Swapped from cron-job.org 2026-07-14: once/day fits the Vercel free tier, and visibility never waits on the cron |
| Database    | **Neon Postgres** (prod/staging), **Docker Postgres** (local) | Serverless driver in deployed envs                                                                                                                                           |
| ORM         | **Drizzle**                                                   | Schema-as-code, migrations via drizzle-kit                                                                                                                                   |
| Auth        | **Better Auth**                                               | Google + Discord OAuth, Drizzle adapter, role field                                                                                                                          |
| Styling     | **Tailwind CSS + shadcn/ui**                                  | shadcn chart components wrap Recharts                                                                                                                                        |
| Client data | **TanStack Query** (comments + admin dashboard only)          | Likes use server actions + `useOptimistic`; beacon is plain `sendBeacon`                                                                                                     |
| Markdown    | **unified** (remark/rehype)                                   | Server-side render, sanitized, YouTube embed transform                                                                                                                       |
| Thumbnails  | **External public URLs**                                      | No storage in v1; `next/image` with `unoptimized`; Vercel Blob later if uploads wanted                                                                                       |
| Moderation  | **Claude Haiku via Vercel AI Gateway**                        | AI SDK, model `anthropic/claude-haiku-4.5`; OIDC auth on Vercel (no key mgmt); optional fallback model; $5/mo included credits cover this workload                           |
| Search      | **Postgres FTS**                                              | Generated `tsvector` + GIN index                                                                                                                                             |
| Analytics   | **Self-hosted in Postgres**                                   | Beacon endpoint + `page_views` table                                                                                                                                         |
| Charts      | **Recharts** (via shadcn/ui charts)                           | Admin analytics dashboard                                                                                                                                                    |

---

## 2. Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │              Next.js on Vercel          │
                    │                                         │
 Visitors ────────▶ │  Public pages (RSC + ISR, tag-cached)   │
                    │   home (browse+search) / posts /        │
                    │   tags / sitemap                        │
                    │                                         │
 Readers ─────────▶ │  Client islands                         │
                    │   comments (TanStack Query),            │
                    │   likes (useOptimistic + action),       │
                    │   view beacon (sendBeacon)              │
                    │                                         │
 Authors/Admin ───▶ │  /admin (dynamic, role-gated)           │
                    │   editor, dashboard, analytics,         │
                    │   moderation log, announcements         │
                    │                                         │
                    │  Route handlers + server actions        │
                    │  /api/cron ◀── Vercel Cron (daily)      │
                    └──────┬──────────────┬───────────────────┘
                           │              │
                    Neon Postgres    Vercel AI Gateway → Haiku
                    (Drizzle)        (comment moderation)
```

### Rendering strategy per route

| Route                        | Strategy                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` (home = browse + search) | PPR: static shell + streamed section reading `?q`/`?category`/`?page` (ADR-0018, ADR-0019). Browse feeds are `use cache` data, `revalidate: 60`, tags `post-list`, `announcements`; `?q=` search reads are never cached |
| `/posts/[slug]`              | ISR per-slug, cache tag `post:{slug}`; comments + likes hydrate client-side                                                                                                                                             |
| `/tags/[slug]`               | PPR: shell + streamed section reading `?page` (ADR-0019); feed data `use cache`, `revalidate: 60`, tag `post-list`                                                                                                      |
| `/admin/**`                  | Fully dynamic, `noindex`, `requireStaff()` in layout + every page (ADR-0009)                                                                                                                                            |
| `/sitemap.xml`               | Route handler, tag `post-list`                                                                                                                                                                                          |

**Key pattern:** post pages are cached static shells; user-specific or fast-changing data (comment tree, like state, view beacon) lives in small client components. Public pages stay fast and cheap, and a new comment never triggers a page rebuild.

---

## 3. Caching Strategy

Four layers, each with a distinct job:

1. **Full Route Cache + Vercel CDN.** ISR pages render once and serve as cached HTML from the edge. Invalidated by (a) time — `revalidate: 60` regenerates in the background at most once per minute, stale-while-revalidate, so no visitor ever waits — or (b) on-demand invalidation from server actions.
2. **Tag-based on-demand invalidation.** Pages declare cache tags (`post:{slug}`, `post-list`, `announcements`). Publish/edit/archive/announcement actions call `revalidateTag(...)`, which correctly invalidates the post page, home, category/tag listings, and sitemap in one shot — no path enumeration to forget.
3. **Time as the scheduled-publish safety net.** Visibility is a query predicate (§4), so a scheduled post becomes queryable at `publish_at` automatically; the next time-based regeneration (≤60s later) surfaces it. The daily cron (Vercel Cron) trues it up by revalidating tags when any `publish_at`/`archive_at` crossed.
4. **Deliberately uncached:** the home page's `?q=` search reads (ADR-0018), `/admin/**`, and all comment/like reads (`no-store`). Interactive reads (comments, likes, comment moderation, the analytics dashboard) are client-fetched with TanStack Query. Filtered admin _lists_ (e.g. the ADM-8 post list) are uncached via dynamic server rendering with URL-param filters instead — client fetching buys nothing for them (ADR-0010).

---

## 4. Data Model

Better Auth manages `user`, `session`, `account`, `verification` tables via its Drizzle adapter. We extend `user` with `role` (`reader` | `author` | `admin`, default `reader`) and `banned_at` (nullable).

### Application tables

```
categories
  id            serial PK
  slug          text unique
  name          text
  active        boolean default true
  sort_order    int

posts
  id            uuid PK
  edit_version  uuid not null          -- mutable editor token, default random UUID; ADR-0030
  author_id     text FK -> user.id      -- RESTRICT; reassignable in bulk via
                                        -- admin post transfer to another
                                        -- active staff member (§5.7,
                                        -- ADR-0027) — e.g. to unblock a
                                        -- staff account's self-deletion (§5.9)
  title         text
  slug          text unique
  body_md       text
  thumbnail_url text                    -- external public image URL (v1)
  banner_url    text null               -- post-page hero image; null falls
                                        -- back to thumbnail_url (added
                                        -- 2026-07-06, owner request; POST-9)
  video_url     text null               -- associated YouTube URL
  category_id   int FK -> categories.id
  status        enum('draft','scheduled','published','archived')
  comments_locked boolean not null default false  -- admin lock (FR-4.4); ADR-0004
  publish_at    timestamptz null
  archive_at    timestamptz null
  content_updated_at timestamptz null   -- stamped ONLY by staged-draft
                                        -- promote (readers saw new content);
                                        -- drives the public "Updated" byline
                                        -- when it exceeds publish_at AND
                                        -- falls on a different viewer-local
                                        -- day (added 2026-07-11, ADR-0016,
                                        -- POST-10; same-day rule ADR-0028)
  created_at    timestamptz
  updated_at    timestamptz
  search        tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('english', title), 'A') ||
                  setweight(to_tsvector('english', body_md), 'B')
                ) STORED                -- GIN index; Postgres derives &
                                        -- maintains this on every write

-- Excerpts are not stored: derived at render time from body_md
-- (strip markdown, first ~160 chars).

post_drafts                            -- staged edits for a public post
  post_id       uuid PK, FK -> posts.id ON DELETE CASCADE
  title         text
  slug          text
  body_md       text
  thumbnail_url text
  banner_url    text null
  video_url     text null
  category_id   int FK -> categories.id
  tags          text[]                -- tag NAMES, not FKs (ADR-0012)
  updated_at    timestamptz            -- display/audit timestamp; edit_version guards writes
                                        -- A row existing IS "pending
                                        -- changes"; the row is a complete
                                        -- snapshot the public never sees
                                        -- until "Publish changes" promotes
                                        -- it (ADR-0011, normalized in
                                        -- ADR-0012)

tags
  id            serial PK
  slug          text unique
  name          text

post_tags
  post_id       uuid FK -> posts.id
  tag_id        int  FK -> tags.id
  PK (post_id, tag_id)

comments
  id            uuid PK
  post_id       uuid FK -> posts.id
  author_id     text FK -> user.id null      -- null = author deleted their
                                              -- account (anonymized, ADR-0026);
                                              -- FK stays RESTRICT otherwise, so
                                              -- a user delete loudly fails if a
                                              -- non-anonymized comment remains
  parent_id     uuid FK -> comments.id null   -- null = top level
  body          text
  status        enum('visible','held','rejected','deleted')
  mod_verdict   jsonb null              -- { verdict, reason, model, latency_ms }
  created_at    timestamptz
  edited_at     timestamptz null
  INDEX (post_id, created_at), INDEX (status, created_at)

post_likes
  post_id       uuid FK -> posts.id
  user_id       text FK -> user.id
  created_at    timestamptz
  PK (post_id, user_id)

comment_likes
  comment_id    uuid FK -> comments.id
  user_id       text FK -> user.id
  created_at    timestamptz
  PK (comment_id, user_id)

announcements
  id            uuid PK
  body          text                    -- ≤500 chars, minimal markdown
  expires_at    timestamptz null
  created_at    timestamptz
  updated_at    timestamptz

page_views
  id            bigserial PK
  post_id       uuid FK -> posts.id null   -- null = non-post page
  path          text
  visitor_hash  text                    -- salted daily hash, no PII (§8)
  created_at    timestamptz
  INDEX (post_id, created_at), INDEX (created_at)
```

### Public visibility is a query, not a job

A post is publicly visible iff:

```sql
status IN ('published','scheduled')
AND publish_at <= now()
AND (archive_at IS NULL OR archive_at > now())
```

"Publish now" sets `status='published', publish_at=now()`. "Schedule" sets `status='scheduled'` with a future `publish_at` — the post becomes visible at that instant with **no job required**. Scheduled archive works identically via `archive_at`. A helper (`visiblePostsWhere()`) encapsulates the predicate for every public query and search.

The only cron (Vercel Cron hitting `/api/cron/revalidate` daily via `vercel.json` — relaxed from the original every-5-min cron-job.org design at launch, 2026-07-14, since public visibility never depends on it: the read-time predicate plus the 60s ISR windows make scheduled transitions live within ~a minute regardless, so the cron only affects admin-badge freshness and staged-draft cleanup on auto-archive): find posts whose `publish_at`/`archive_at` crossed since the last run → `revalidateTag` for the affected post, `post-list`, and sitemap. The endpoint should be idempotent and track "last run" in the DB rather than trusting call timing, so a missed or duplicated trigger is harmless. The same run also **normalizes stored statuses** to match the visibility predicate (`normalizePostStatuses`): `scheduled → published` once `publish_at` passes, and `published/scheduled → archived` once `archive_at` passes — so the admin badge isn't stuck showing "Scheduled" for a post that is already public. Self-healing (targets every currently-stale row, not just the last window); archiving also clears any staged draft (ADR-0011) so a pending snapshot isn't stranded on a now-hidden post.

---

## 5. Key Flows

### 5.1 Markdown pipeline

Server-side in the post page RSC (captured by ISR, so it runs once per revalidation, not per request):

```
remark-parse → remark-gfm → remark-rehype
  → rehype-sanitize (strict schema; allowlist iframe only for youtube.com/youtube-nocookie.com)
  → custom rehype plugin: bare YouTube URLs / links → responsive embed
  → rehype-pretty-code (optional, code blocks)
  → rehype-stringify
```

The associated `video_url` renders as an embed component below the title, independent of the body pipeline. Use `youtube-nocookie.com` with a click-to-load facade (lite-youtube pattern) — eager YouTube iframes wreck mobile load performance.

### 5.2 Comment creation (moderation + rate limiting)

```
POST comment (server action, authed)
 1. Reject if user banned, post archived, or comments locked
 2. Rate limit (two Postgres counts on comments by author_id):
      > 3 in last minute  → error
      > 30 in last hour   → error
      (values in env/config)
 3. Moderate via AI SDK → Vercel AI Gateway → anthropic/claude-haiku-4.5
      strict JSON verdict: { "verdict": "allow" | "flag", "reason": "..." }
      gateway-level fallback model optional; ~5s timeout
 4. Insert comment:
      allow        → status 'visible'   (appears immediately)
      flag         → status 'rejected'  (final; user sees brief rejection
                                          message; never published)
      error/timeout→ status 'held'      (fail-closed; user told it's
                                          pending review)
 5. mod_verdict jsonb stored on every comment for audit
```

Edits re-run steps 2–4 on the new body and count against the same rate limits (each edit is a fresh moderation call) — a flagged edit demotes the comment to `rejected`/`held` (ADR-0020).

**Auto-ban (FR-4.9, ADR-0022):** after any write that lands a comment in `rejected`, the service counts the author's currently-`rejected` comments in a rolling window (`created_at` or `edited_at` newer than the window start; defaults 5 in 7 days, env-configurable). At/above threshold it bans via the users domain's locked ban service — same last-active-admin invariant as a manual ban, no-op if already banned. The step is fire-and-forget: a ban failure never alters the commenter's rejection result. Because the count is live, an admin restoring a false positive un-counts it; `held` rows (LLM failures) never count. Ban state is shown on moderation-log rows; unban stays on the users screen.

**Moderation log (admin):** all `rejected` and `held` comments are browsable with the model's verdict and reasoning. Its purpose is _monitoring_, not an approval workflow — rejections are final by default. `held` items (LLM failures only) await an approve/delete decision; a restore action also exists on `rejected` for clear false positives.

**Moderation policy (finalized):**

- **Flag:** NSFW/sexual content; any profanity (family-friendly standard — judge the _words_, not the intensity of the take); slurs; targeted personal attacks on other commenters; spam/scam/malicious links.
- **Allow:** heated sports takes, trash talk, and harsh criticism of players, teams, coaches, and takes — provided the language stays clean; insults that are clearly banter rather than targeted attacks; links generally (any domain), unless spammy or malicious.
- The prompt must state explicitly that intensity/negativity alone is never a reason to flag — only the categories above — or an eager classifier will flag half the comment section during rivalry week. Keep a few-shot example set in the repo pairing allowed heated comments against flagged equivalents (same take ± profanity is a great contrast pair).

Cost: Haiku on a ~100-token comment is a fraction of a cent; Vercel's included monthly AI Gateway credits cover this workload outright, and the gateway adds zero token markup.

### 5.3 Comment tree

One query per post via a route handler (`GET /api/comments?postId=...`, `no-store`) — reads go through GET route handlers so TanStack Query can fetch/refetch freely, while writes stay in server actions. `WHERE post_id = ?` across all statuses (amended by ADR-0020: a re-moderated edit can flag a parent that still has visible replies, so the placeholder rule generalizes beyond `deleted`), tree assembled in memory by `parent_id`. Non-visible comments are redacted server-side (body/author stripped) and render as placeholders only when they have visible descendants. The response's `meta` carries `comments_locked` so lock toggles never touch the cached post page (ADR-0020). UI indents to depth ~5, then flattens with "replying to @name" labels (critical on phone widths). Fetched and mutated via TanStack Query with optimistic inserts on `allow` — the one island complex enough to earn the dependency.

### 5.4 Likes

Server action toggling insert/delete on the composite-PK like tables (idempotent by construction), wired to `useOptimistic` on the client — no client fetching library involved. Counts via `COUNT(*)` at read time; initial like state and counts are fetched alongside the comment tree (comments) or inlined in a tiny dynamic fetch (post like button). Banned users blocked at the action level.

### 5.5 Search

```sql
SELECT ..., ts_rank(search, q) AS rank
FROM posts, websearch_to_tsquery('english', $1) q
WHERE <visiblePostsWhere()>
  AND (search @@ q
       OR EXISTS (tag match ILIKE)
       OR category name ILIKE)
ORDER BY rank DESC, publish_at DESC
```

`websearch_to_tsquery` gives forgiving, Google-ish syntax. Snippets via `ts_headline`. Optional `category` param ANDs a category filter (FR-3.3). Search lives on the home page (`/?q=`, combinable with `?category=` — ADR-0018): debounced input, search reads never cached.

### 5.6 Analytics

**Ingest:** a tiny client component on every public page fires `navigator.sendBeacon('/api/view', { path, postId? })` once per pageview. The handler computes `visitor_hash = sha256(daily_salt + ip + user_agent)` and inserts a row. The salt rotates daily — hashes can't be correlated across days and no raw IP/UA is stored. Basic bot filtering: drop known bot UAs; the beacon requiring JS filters most scrapers.

**Dashboard (admin):** shadcn/ui chart components (Recharts) over aggregate queries — traffic over time (`count(*)` + `count(distinct visitor_hash)` by day/week/month), top posts, views by category, per-post views, engagement (comments/likes per post, most-liked). Raw rows + indexed aggregates are instant at this scale; a nightly rollup table is deliberately deferred until needed.

### 5.7 Admin & authoring

- **Access:** middleware redirects cookieless requests from `/admin/**` (UX only); `requireStaff()` gates the admin layout and every admin page (layouts and pages render in parallel, so a layout-only gate can't protect page content — ADR-0009); every server action re-checks role (action checks are the security boundary). Authors scoped to `author_id = self`; admin unscoped.
- **Editor:** Markdown textarea + toggleable preview pane running the _same_ rendering pipeline as production (server action returns rendered HTML) — guarantees preview fidelity (FR-7.2). The post row is created only on an explicit save; interval autosave then keeps an existing post current, and the publish/status/schedule controls flush unsaved edits (and abort on failure) before acting (ADR-0015).
- **Staged edits on public posts (ADR-0011, normalized in ADR-0012):** editing a post that is publicly visible right now (`isPubliclyVisible()`, not status alone) autosaves into the `post_drafts` table (a complete pending snapshot, one row per post) instead of the live columns, so the public keeps seeing the current content until the author hits "Publish changes" (promotes + revalidates) or "Discard changes". Anything not yet public — drafts, archived, and a scheduled post still awaiting its `publish_at` — writes through immediately. Buffer writes compare the browser's `editVersion` under the parent lock (ADR-0030); promote and discard compare the request-loaded `posts.edit_version` under that same lock; the lifecycle actions guard "no `post_drafts` row for this post" so a pending snapshot can't be stranded by a racing status/schedule change, and a post with pending changes can't change status or (re)schedule until it's published or discarded. Editor/preview read the snapshot when present via a LEFT JOIN.
- **Thumbnails:** a URL field. Rendered with `next/image` + `unoptimized` + explicit dimensions (avoids maintaining a `remotePatterns` allowlist / open-proxy risk while keeping lazy loading and layout stability). Known tradeoffs: link rot and hotlink-blocking hosts. Revisit with Vercel Blob if uploads are ever wanted.
- **Hard delete (ADR-0027):** authors archive by default (recoverable, FR-1.6). Authors may additionally hard-delete a post that has never been public: the delete is one guarded `DELETE ... WHERE author_id = self AND status IN ('draft','scheduled') AND (publish_at IS NULL OR publish_at > now()) AND NOT EXISTS (comments on the post)` — status alone can't prove "never public" (published→draft is a legal transition, and a scheduled post past `publish_at` is live until the cron flips it), and the no-comments guard protects bystander threads (comments cascade on post delete) on a reverted draft that was once public. `ManageAnyPost` bypasses all of this (admin delete-any, any status). The edit page's delete control appears for owners of Draft/Scheduled posts as a visibility hint only — the guarded statement is what actually enforces it. Cascades remove the pending snapshot and tag joins; revalidates the list + post tags.
- **Post transfer (ADR-0027):** from the admin users screen, an admin (`ManageAnyPost`) can bulk-reassign every post authored by one user to another active staff member (role Author/Admin, not banned) — `UPDATE posts SET author_id = target WHERE author_id = source`. Revalidates `post-list` plus every affected `post:{slug}` tag, since public pages render the author byline (FR-1.7). Primary use: unblocking a staff account's self-deletion (§5.9) when it has ever-public or commented posts.
- **Moderation log, announcements, categories, users (roles/bans):** simple CRUD screens.
- **Preview:** `/admin/preview/[id]` renders any draft/scheduled post with the public layout, auth-gated.

#### Safe concurrent saves and AI review (ADR-0030)

`posts.edit_version` is an opaque UUID, distinct from timestamps or future revision-history IDs. AIR-2 requires it on every existing-post save and compares it under the parent post lock on both direct and staged writes, including no-ops. Each editorial/lifecycle/ownership update and staged-buffer mutation replaces it atomically; transfer/lifecycle/promote/discard invalidate older editors. Validate the direct/staged destination under the lock against actual visibility, so a scheduled time crossing cannot write a staged edit live. Return the committed version on success. A structured conflict stops autosave while retaining the full local form; export and deliberate reload provide recovery. Never silently refresh the token and retry stale content. The comment-lock toggle explicitly preserves the current token: moderation state is outside the editorial snapshot and must not force saving or losing unsaved writing. Successful status/schedule changes reload content and token together, retaining the unsaved-change warning for late keystrokes.

AIR-3 adds immutable `edit_proposals`, using this same source version, base/candidate content snapshots, server-generated diffs and separate editorial/source/media notes. The table stores agent identity/label, skill name/hash, source UUID and visibility, immutable base/candidate snapshots, diff format v1, structured notes, status and human decision fields. A partial unique constraint permits one open AI proposal per post. Human selective apply rechecks ownership, version and lifecycle atomically; public posts receive only staged changes. Stale proposals cannot merge; retain closed proposals until post deletion. The Paulitakes Editor skill is the required editorial brief, explicitly loaded by the Codex workflow and identified by name/hash in attribution. Later collaboration reuses this foundation; full REV history is not a prerequisite.

The comparison uses exact line hunks with server-issued IDs and whole-field metadata changes. Whitespace, CRLF and terminal newlines are preserved. jsdiff is bounded to 1,000 edits and 50ms; an over-budget body becomes one explicitly marked complete replacement. Applying every change must reconstruct the candidate exactly. Applying a subset reconstructs from immutable stored snapshots/diff, then validates the entire selected result (including length, category, slug and thumbnail). Notes are never copied into article fields. Selecting no changes uses rejection instead; notes-only proposals are valid.

All proposal writes lock the parent post first, including creation, explicit supersession and human decisions. Application validates the source UUID, original visibility and ownership under that lock, and writes the post or staged snapshot together with accepted/rejected change IDs, actor and resulting version. A final visibility check rejects time boundaries during the operation. A nonpublic direct application consumes any obsolete staged row (e.g. a timed archive preceding status normalization), so the editor cannot overlay the old buffer. Successful direct writes revalidate the list and old/new slug tags; staged writes and proposal-only decisions do not touch public caches. Rejection and supersession retain immutable content; deleting the post cascades all proposals. Deleting a deciding account nulls its decision FK, preserving the article's proposal history.

AIR-4 adds `/admin/posts/[id]/reviews` and its proposal detail route, both using owner/admin-scoped services. History pages contain 50 entries ordered by creation time and ID. Editor navigation flushes the form and stops on validation/save conflicts; full navigation retains the unsaved-change warning for keystrokes typed during that save. The review shows exact before/suggested text, complete snapshots, opt-in body/metadata selections, the reconstructed selected result and a preview through the existing sanitized Markdown action. Editorial/fact/media notes stay separate; agent fact-check labels are explicitly assessments. Apply/reject require confirmation, explain closure and private staging/scheduled behavior, and use the existing guarded actions. A selected public slug change shows its URL impact. Closed reviews show recorded selections; stale ones remain readable/rejectable.

AIR-3 exposes owner/admin read/apply/reject server actions. AIR-5 supplies the authenticated principal to the shared server-only submission service through an isolated agent creation endpoint. It validates strict candidate/notes/skill inputs and logs only fixed operation labels on errors, never database parameters or draft text. Skill attribution documents the supplied brief; it does not certify compliance or factual correctness.

AIR-5 implements the scoped REST API; AIR-6 adds the thin local Codex MCP adapter. Only proposal creation may be an agent POST; the existing server-action rule continues for human post/lifecycle mutations. Use a dedicated configured token and sanitized audit patterns from Picksleagues, with fixed review-read/proposal-create capabilities and revocation through token replacement/removal and server restart/redeployment (ADR-0032). Agent access includes all authors' reviewable content, never human admin authority or user/comment/analytics data.

AIR-5 implements `/api/agent/v1/drafts`, `/drafts/[id]` and `/edit-proposals` under that prefix. [ADR-0032](adr/0032-single-configured-agent-token.md) simplifies authentication to one `AGENT_API_TOKEN` per environment; there is no credential-management CLI or table. One stable server principal owns automatically initialized `agent_api_state` quota counters and `agent_receipts` keyed by principal/request UUID. Rotation preserves quota and receipt identity. The [operator runbook](runbooks/agent-api.md) documents setup, revocation and the contract. Reads and proposal creation do not mutate public content or invalidate public caches.

### 5.8 SEO & sharing

- Metadata API per post: title, description (derived excerpt), canonical URL
- Home canonical follows its mode (SEO-10, `homeCanonical()`): bare feed → `/`; category browse → `/?category={slug}` (it is the category listing); search (`?q=`) → `/` + `noindex`; `page` > 1 stays self-referencing
- `og:image` = post thumbnail URL (FR-1.4); a branded `next/og` card (`src/app/opengraph-image.tsx`, BRAND-3/ADR-0024) is the site-wide fallback for routes without their own image
- `sitemap.xml` route handler over visible posts, revalidated by tag
- `robots.txt` disallows `/admin`

### 5.9 Account deletion (FR-10.4)

A confirm `AlertDialog` on `/account` calls Better Auth's `authClient.deleteUser()`. Guards and anonymization run server-side in a `beforeDelete` hook, not the client:

Both refusal checks (steps 1–2) run to completion, with no writes, before anything is written (step 3 onward) — the locked transaction commits when the `beforeDelete` callback returns normally and only rolls back on throw, so a refusal that ran after a write would still commit that write despite reporting the deletion as refused.

1. **Refuse if the user has any post that would survive the purge** — a post that's ever been published, or a never-public post with a real comment thread, blocks deletion; the message directs the user to the site owner to transfer (§5.7 post transfer) or delete those posts first (ADR-0027, narrowing the original blanket "staff with authored posts" refusal from ADR-0026). This check and the purge in step 3 share the exact same guarded predicate from §5.7 (Draft, or Scheduled with a future `publish_at`, and commentless) evaluated at the same instant, so a draft-only account is never wrongly refused.
2. **Refuse if the deleting user is the last active admin** — same locked-admin-set machinery the users domain's ban service uses for the last-active-admin invariant (§5.2), so a concurrent ban/role change can't race a delete into leaving zero admins.
3. **Purge never-public posts** — only once both refusals above have passed: inside the same locked transaction, delete every post authored by the user that matches the guarded hard-delete predicate from §5.7.
4. **Anonymize comments in one UPDATE**: `author_id = NULL, status = 'deleted', body = '', mod_verdict = NULL` for every comment authored by the user — a single statement in the same transaction. Placeholder-vs-hidden display is unchanged (§5.3): the row still renders as an authorless "[deleted]" placeholder only where it has visible descendants, otherwise it disappears.
5. Better Auth then deletes the `user` row; `account` (OAuth identities), `session`, `post_likes`, and `comment_likes` rows cascade via FK.

**Accepted race:** the admin-set lock used in step 2 releases before Better Auth performs the row delete in step 5, so two admins self-deleting at the same instant could theoretically both pass the last-active-admin check and leave zero admins. Accepted for this site's scale (ADR-0026, account deletion & anonymization) — not worth a cross-request lock for a single-operator blog. Separately, a post transfer (§5.7) landing on this user between the refusal check (step 1) and the row delete (step 5) is backstopped by `posts.author_id`'s FK RESTRICT — the user-row delete fails loudly rather than silently orphaning the transferred post or the deleting user's account (ADR-0027).

---

## 6. Project Structure (sketch)

Layout updated per ADR-0013 (thin action/route-handler boundaries; `src/lib` reorganized by domain into a service/data layering).

```
src/
  app/
    (public)/
      page.tsx                    # home: announcements + browse/search
                                   # (?q, ?category — ADR-0018)
      posts/[slug]/page.tsx
      tags/[slug]/page.tsx
    admin/
      page.tsx                    # post list dashboard
      posts/[id]/edit/page.tsx
      preview/[id]/page.tsx
      analytics/page.tsx
      moderation/page.tsx         # moderation log
      announcements/page.tsx
      categories/page.tsx         # category management (ADR-0017)
      users/page.tsx              # roles, bans (ADM-10)
      _components/                # colocated, single-route components
    api/
      auth/[...all]/route.ts      # Better Auth handler
      view/route.ts               # analytics beacon
      admin/analytics/route.ts    # dashboard aggregates (admin, no-store;
                                   # ADR-0025)
      comments/route.ts           # comment tree reads (no-store)
      cron/revalidate/route.ts    # Vercel Cron target (secret-protected)
                                   # route handlers: validate -> guard -> delegate
                                   # to a lib service, same as actions/
  components/                     # components shared across route segments
    ui/                           # shadcn/ui primitives
  db/schema.ts                    # Drizzle schema
  lib/                            # organized by domain; a single-route
                                   # component instead lives in that route's
                                   # own _components/ (see app/ above)
    auth/                         # session, permissions, roles, guards,
                                   # redirect-target, Better Auth client
    posts/                        # posts, status, input, autosave, admin,
                                   # home-feed, revalidation
      service/                    # business logic, split by sub-domain
      data.ts                     # all Drizzle access for the domain
    users/                        # admin, display-name
      service.ts
      data.ts
    categories/                   # input, service, data (ADR-0017)
    content/                      # markdown, excerpt, image-src
    admin/                        # cross-domain admin-screen helpers
                                   # (route-params, search)
    shared/                       # cache, env, sql-like, slug, action-result
    utils.ts                      # shadcn generators hardcode "@/lib/utils"
  actions/
    posts/                        # crud.ts, draft.ts, lifecycle.ts
    categories.ts
    users.ts
    preview.ts
```

Each domain under `lib/` follows the same shape: `service*.ts` holds business logic (server-only), `data.ts` holds all DB access (server-only, pure queries/mutations + error classification, no business rules). Actions in `actions/` and route handlers under `app/api/` are thin: validate input (zod) -> check auth (a guard) -> delegate to a domain service.

---

## 7. Environments & Configuration

| Env         | Branch                 | Database                                        | URL                                                                           | OAuth                                        |
| ----------- | ---------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| **Local**   | any                    | Postgres in Docker (match Neon's major version) | `localhost:3000`                                                              | Dedicated OAuth client, `localhost` redirect |
| **Staging** | `staging` (long-lived) | Neon `staging` branch (persistent)              | Fixed domain (e.g. `staging.paulitakes.com`) assigned to the branch in Vercel | Dedicated OAuth client, staging redirect     |
| **Prod**    | `main`                 | Neon `main`                                     | `www.paulitakes.com` (apex redirects to www)                                  | Dedicated OAuth client, prod redirect        |

- The stable staging URL exists specifically so Google/Discord redirect URIs can be registered ahead of time — ephemeral preview URLs can't be. Separate OAuth clients per environment keep a leaked staging secret away from prod.
- No per-PR database branches; PRs merge to `staging` for integration testing, then `staging` → `main`.
- **Env vars:** `DATABASE_URL`, `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL`, per-env Google/Discord creds, `AI_GATEWAY_API_KEY` (local only — deployed envs use Vercel OIDC automatically), `CRON_SECRET`, `ANALYTICS_SALT_SEED`, rate-limit values.
- **Migrations:** drizzle-kit, applied via CI step before deploy (staging first, then prod).
- **Bootstrap:** first admin promoted via a one-time seed script (no in-app path to self-promote).

---

## 8. Security & Privacy Notes

- All mutations are server actions with per-action session + role + ownership checks; middleware is convenience only.
- `rehype-sanitize` on all rendered markdown (posts _and_ announcements); comments are plain text with escaped output and auto-linked URLs (`rel="nofollow ugc"`).
- Thumbnail URLs validated as `https://` image URLs; rendered `unoptimized` to avoid the open image-proxy problem with wildcard `remotePatterns`.
- Cron endpoint requires an `Authorization: Bearer ${CRON_SECRET}` header — Vercel Cron sends it automatically because the env var is named `CRON_SECRET`. Reject anything without it; the route does nothing destructive regardless (it only revalidates caches), so worst case for a leaked URL is extra cache churn.
- Analytics stores only salted daily hashes — no IPs, no cookies, no cross-day correlation.
- Banned users: checked on comment and like actions; sessions not revoked (they can still read).
- Account deletion is self-serve (§5.9); anonymization leaves no PII on retained comment rows — author, body, and moderation verdict are all cleared.

---

## 9. Build Order (suggested)

1. Scaffold Next + Tailwind/shadcn + Drizzle + local Docker Postgres + Better Auth (Google/Discord, roles); set up staging/prod envs early so OAuth is settled
2. Posts data model + markdown pipeline + public post page & home (static content end-to-end, tag-based caching)
3. Admin: editor, drafts, preview, thumbnail URLs, scheduling (+ cron revalidation)
4. Categories, tags, search
5. Comments (tree UI, gateway moderation, rate limits, moderation log)
6. Likes
7. Announcements
8. Analytics ingest + dashboard
9. SEO polish (metadata, sitemap, OG), mobile pass, launch

Each step ships something usable; the site is launchable after step 4 with comments off.

---

## 10. Resolved (was Open Items in v0.1)

1. **Styling:** Tailwind + shadcn/ui.
2. **Excerpts:** auto-derived from body, no stored field.
3. **Moderation posture:** flagged = rejected outright, logged with verdict for admin monitoring; only LLM failures await review.
4. **Environments:** local Docker Postgres / staging branch + fixed URL / prod. No per-PR branches.
5. **Model access:** Vercel AI Gateway.

## 11. Final Decisions (was Remaining Open Items)

1. **Moderation policy:** family-friendly — flag all profanity, slurs, NSFW, targeted personal attacks on commenters, and spam/scam links; allow heated takes, trash talk, and links from any domain. Full policy in §5.2; few-shot examples to live in the repo and be tuned against real comments post-launch.
2. **Comment reads:** GET route handler (`/api/comments`), `no-store`; writes remain server actions.

**No open items remain — design is locked at v0.3.**
