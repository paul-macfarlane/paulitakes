# Paulitakes — Product Doc

**Version:** 0.2 (Draft)
**Owner:** Paul
**Last updated:** July 4, 2026

---

## 1. Overview

> Why the site exists, why it's custom-built, and the content philosophy live in [`vision.md`](vision.md). This document covers what it does.

**Paulitakes** is a sports blog where Paul publishes his takes — opinion pieces, analysis, and reactions, almost entirely sports-related. The site is web-based and designed mobile-first: a large share of readers will arrive on phones, so every page must be comfortably readable and fully functional on small screens.

The site is intentionally small in scope but built to support multiple authors from day one. Paul is the initial admin and primary author; additional authors can be added later without rework.

Posts are written in Markdown and rendered on the site. Each post has a thumbnail and can optionally embed an associated YouTube video (all video lives on YouTube — no native hosting). Content is organized with a fixed set of categories (NFL, NBA, MLB, College Football to start) plus freeform tags, and is fully searchable, including full-text search of post bodies.

Readers engage through fully nested comment threads and likes on posts and comments. Commenting requires sign-in via Google or Discord. To keep the site clean with near-zero manual moderation, new comments pass through an inexpensive LLM check for NSFW/spam content, and per-account rate limits prevent comment flooding.

The homepage features recent posts alongside a dedicated announcements section for short admin updates. An admin area provides full content lifecycle control (create, edit, preview, draft, schedule publish, schedule archive) plus an analytics dashboard visualizing site traffic and per-post views.

### Goals

- Give Paul (and future authors) a home for sports takes with minimal publishing friction: write Markdown, hit publish.
- Deliver a great reading experience on phones first, desktop equally.
- Let readers find content easily via categories, tags, and full-text search.
- Enable engagement (nested comments, likes) with low spam risk and near-zero moderation burden via automated LLM screening and rate limiting.
- Give the admin visibility into traffic and engagement through an analytics dashboard.
- Keep operational overhead tiny — this is a small personal site, not a platform.

### Non-Goals (for v1)

- Native video hosting (all video lives on YouTube).
- Newsletters, RSS-to-email, push or reply notifications. (A plain RSS feed is in scope — FR-9.6.)
- Monetization (ads, subscriptions, paywalls).
- Guest/anonymous commenting.
- Native mobile app (mobile web only).

---

## 2. Users & Roles

| Role                       | Description                             | Capabilities                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visitor**                | Anyone, no account                      | Browse, read posts, view announcements, search, filter by category/tag, view comments and like counts                                                                                                               |
| **Reader** (authenticated) | Signed in via Google or Discord         | Everything a Visitor can do, plus: comment, reply in threads, edit/delete own comments, like/unlike posts and comments                                                                                              |
| **Author**                 | Contributor account designated by admin | Everything a Reader can do, plus: create, edit, preview, draft, schedule publish, schedule archive, and permanently delete **their own** never-published posts                                                      |
| **Admin** (Paul)           | Site owner                              | Everything an Author can do on **all** posts, plus: announcements, comment moderation, user management (roles, bans), transferring a user's posts to another staff member, category management, analytics dashboard |

---

## 3. Functional Requirements

### 3.1 Posts

- **FR-1.1** — A post consists of: title, slug (auto-generated from title, editable), author, body (Markdown), thumbnail image, exactly one category, zero or more tags, optional associated YouTube video, publish timestamp, and status.
- **FR-1.2** — Post body is authored in Markdown and rendered to HTML on the public site. Rendering supports standard Markdown (headings, lists, links, images, code blocks, blockquotes, tables). Headings get stable ids and a copy-link anchor so sections are directly linkable (added 2026-08-27; backlog POST-11).
- **FR-1.3** — YouTube links inside the post body render as embedded players. A post's "associated video" renders as an embedded player in a consistent position (e.g., below the title / above the body).
- **FR-1.4** — Every post has a thumbnail image, shown on post listings, the homepage, and as the social share image (Open Graph / Twitter card).
- **FR-1.5** — Post statuses: `Draft`, `Scheduled`, `Published`, `Archived`.
- **FR-1.6** — Archived posts are unpublished but recoverable: removed from public listings, search, and direct URLs, but retained in the admin area and restorable to Draft or Published.
- **FR-1.7** — Published posts display an author byline.

### 3.2 Categories & Tags

- **FR-2.1** — Categories are a fixed, admin-managed list. Initial set: **NFL, NBA, MLB, College Football**. Admin can add, rename, and deactivate categories.
- **FR-2.2** — Each post belongs to exactly one category.
- **FR-2.3** — Tags are freeform, created inline while authoring. A post can have any number of tags.
- **FR-2.4** — Each category and each tag has a public listing view of its published posts, newest first. For categories this is the home page filtered in place (`/?category=…`, combinable with search — amended 2026-07-11 by Paul, ADR-0018); tags keep dedicated pages (`/tags/[slug]`).

### 3.3 Search

- **FR-3.1** — Site-wide search covers post titles, bodies (full text), categories, and tags. Only published posts are searchable.
- **FR-3.2** — Results show thumbnail, title, category, date, and a snippet with match context.
- **FR-3.3** — Search can be combined with a category filter.

### 3.4 Comments

- **FR-4.1** — Commenting requires authentication via Google or Discord OAuth. Reading comments does not.
- **FR-4.2** — Comments support fully nested threading (arbitrary depth; UI may visually flatten beyond a depth of ~5, especially on mobile).
- **FR-4.3** — Users can edit and delete their own comments. Deleting a comment with replies leaves a "[deleted]" placeholder to preserve the thread.
- **FR-4.4** — Admin can delete any comment and can lock comments on a specific post (existing comments remain visible, no new ones allowed).
- **FR-4.5** — Comments are plain text with basic formatting (line breaks, auto-linked URLs). No images or embeds.
- **FR-4.6** — **Automated moderation:** every new comment is screened by an inexpensive LLM for NSFW content, spam, and abuse before becoming visible. Clean comments post immediately; flagged comments are rejected with a brief message to the user and logged for admin review (admin can approve false positives).
- **FR-4.7** — **Rate limiting:** per-account limits on comment creation (e.g., max N comments per minute and M per hour) to prevent flooding. Limits are configurable.
- **FR-4.8** — Admin can ban a user, preventing them from commenting and liking.
- **FR-4.9** — **Auto-ban:** a user whose count of currently-rejected comments within a rolling window crosses a threshold (default 5 in 7 days; both configurable) is banned automatically. Held comments never count; restoring a false positive un-counts it. Auto-banned users are visible in the moderation log; admin can unban as with any ban.

### 3.5 Likes

- **FR-5.1** — Authenticated users can like posts and comments; one like per user per item, toggleable (like/unlike).
- **FR-5.2** — Like counts are publicly visible on posts and comments.
- **FR-5.3** — Like activity feeds into the analytics dashboard (e.g., most-liked posts).

### 3.6 Announcements

- **FR-6.1** — Announcements are short, standalone messages (plain text or minimal Markdown, ~500 character cap) created only by the admin.
- **FR-6.2** — Announcements appear in a dedicated section on the homepage, newest first, showing the most recent few (e.g., 3–5).
- **FR-6.3** — Announcements can be created, edited, and deleted, with an optional expiration date after which they no longer display.
- **FR-6.4** — Announcements do not support comments or likes.

### 3.7 Authoring & Content Management

- **FR-7.1** — Dashboard lists posts with filtering (status, category, author) and sorting (updated, published date). Authors see their own posts; admin sees all.
- **FR-7.2** — Post editor: Markdown input with live or toggleable preview rendering exactly as the public site will.
- **FR-7.3** — Thumbnail set via an external public image URL (validated `https://` image). No in-app upload/storage in v1; revisit (e.g. Vercel Blob) if uploads are wanted. See technical-design.md §5.7. **Amended 2026-08-27:** in-app upload to Vercel Blob for thumbnail, banner, and body images is planned (backlog MEDIA epic); URL paste stays supported.
- **FR-7.4** — Draft: posts can be saved in Draft indefinitely, invisible to the public.
- **FR-7.5** — Schedule publish: set a future date/time; the post automatically becomes Published at that time.
- **FR-7.6** — Schedule archive: set a future date/time on a published post; the post automatically becomes Archived at that time.
- **FR-7.7** — Preview: any Draft or Scheduled post can be viewed rendered as it will appear publicly, via a private preview.
- **FR-7.8** — Authoring and admin routes are restricted to the appropriate roles.
- **FR-7.9** — An author may permanently delete one of their own posts that has never been public: Draft, or Scheduled with a future publish time, and only if the post has no comments. Admin may permanently delete any post regardless of status.
- **FR-7.10** — Admin can transfer all of a user's posts to another active staff member (Author or Admin, not banned), e.g. to unblock that user's account deletion or reassign ownership.
- **FR-7.11** — Every existing-post save carries the version loaded by the editor. Stale saves change nothing, stop autosave, and preserve all unsaved content/metadata with export and deliberate reload. This safety foundation ships with AI review and is reused by later collaboration.
- **FR-7.12** — Requested AI reviews use the Paulitakes Editor brief, preserving each author's voice. The shared Reviews experience presents each suggestion with its own explanation and relevant sources, identifying the reviewer explicitly. Future human reviews use the same format; collaboration permissions remain separately scoped. Agents propose body/metadata edits separately, with complete visible differences and sourced editorial/fact-check/media notes. All authors' drafts and published posts are eligible. One open AI proposal per post, retained closed history; stale proposals require a new review. Only an authorized human applies selected changes; application to public posts stages privately and publication is separate. _(Storage/diffs/guarded decisions: AIR-3; human review UI: AIR-4; agent integration remains AIR-5–6.)_
- **FR-7.13** — Agent access uses one independently configured token per environment, with fixed review-only capabilities, revocation by token replacement/removal and sanitized audit; it exposes only review content and proposal creation. No sessions, account data, comments, analytics, direct content writes or publishing capabilities. Local Codex is the first client. _(Server API: AIR-5; local Codex adapter: AIR-6.)_

### 3.8 Analytics

- **FR-8.1** — The site tracks page views per post and overall site traffic. Tracking should be privacy-conscious (no third-party ad trackers; aggregate counts, not individual profiles).
- **FR-8.2** — Admin analytics dashboard with visuals: traffic over time (daily/weekly/monthly), views per post, top posts, views by category, and engagement metrics (comments, likes).
- **FR-8.3** — Per-post view counts are visible to admin (and optionally to authors for their own posts); public display of view counts is not required in v1.

### 3.9 Public Site

- **FR-9.1** — Homepage: announcements section + recent published posts (thumbnail, title, category, author, date, short excerpt), with pagination or "load more."
- **FR-9.2** — Post page: title, author, date, category, tags, associated video (if any), rendered Markdown body, like button, comment thread. Shows an "Updated" date when content changed after publish (staged-edit promote only; added 2026-07-11, ADR-0016, POST-10), except when the edit falls on the same viewer-local calendar day as the publish (ADR-0028, SEO-9). Cards/feed stay publish-date-only. All dates render in the viewer's local timezone (ADR-0028, SEO-8).
- **FR-9.3** — Global navigation: home, categories, search.
- **FR-9.4** — **Mobile-first responsive design:** layouts, typography, embedded video players, comment threads, and the like/comment interactions must all be designed for phone screens first and scale up to desktop.
- **FR-9.5** — SEO basics: per-post meta titles/descriptions, Open Graph tags, sitemap, clean URLs (e.g., `/posts/my-hot-take`).
- **FR-9.6** — RSS feed: a single site-wide feed at `/feed.xml` of published, visible posts (newest first, capped), each entry carrying the full rendered post body. Entries are keyed by post id and dated by publish date; post-publish edits update the entry in place without re-dating it. Advertised via `<link rel="alternate">` and a footer link. (Added 2026-08-27; backlog FEED epic.)

### 3.10 Authentication & Accounts

- **FR-10.1** — Sign in with Google or Discord only. No email/password.
- **FR-10.2** — Accounts store: display name (editable), avatar (from provider), linked provider identity, and role (Reader by default; Author/Admin assigned by admin).
- **FR-10.3** — Reader accounts exist to enable commenting and liking; no public profiles in v1.
- **FR-10.4** — Self-serve account deletion: a signed-in user can delete their own account after confirmation. Deletion removes the account, provider identities, sessions, and likes; comments are anonymized thread-preservingly (authorless "[deleted]" placeholders). Any never-published posts the user authored (see FR-7.9) are deleted automatically as part of account deletion. Refused only for a staff member whose remaining posts were ever published or have comments (admin can transfer those posts to another staff member first, per FR-7.10, or delete them) and for the last active admin.

---

## 4. Resolved Decisions

1. **Name:** Paulitakes.
2. **Comment reply notifications:** not in v1 (future idea).
3. **Initial categories:** NFL, NBA, MLB, College Football.
4. **Likes:** in v1, on both posts and comments.
5. **Analytics:** in v1 — page view tracking plus an admin dashboard with visuals.
6. **Multiple authors:** supported in v1 via the Author role.

## 5. Open Questions

1. **LLM moderation details** — which model/provider, cost ceiling, and fallback behavior if the moderation call fails (fail-open vs. hold for review)? To be settled in technical design.
2. **Rate limit values** — pick sensible defaults (e.g., 3/min, 30/hour) during technical design.

---

## 6. Future Ideas (explicitly not v1)

- Per-category / per-tag / per-author RSS feeds (site-wide feed is FR-9.6)
- Comment reply notifications
- Related posts recommendations
- Public author profile pages
- Public view counts on posts
