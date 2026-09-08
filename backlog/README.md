# Backlog

Work split by epic to keep context small. One file per epic, ordered by the build order in `docs/technical-design.md` §9. The site is launchable after `03-search` with comments off.

## Task format

Each task is a checkbox with a stable ID:

```
- [ ] **FND-1** — Short description. _(deps: none)_
```

Status markers:

- `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Keep the ID stable once created — commands, ADRs, and commits reference it. Add new tasks by appending the next number in that epic; don't renumber.

Write tasks as **goals**: the outcome plus the FR-x.y / technical-design § that defines it. Don't restate design-doc mechanics in the task line — the design doc is the source of truth for _how_, and inline copies drift.

## Epics

| File                    | Prefix  | Epic                                                    |
| ----------------------- | ------- | ------------------------------------------------------- |
| `00-foundation.md`      | `FND`   | Scaffold, auth, environments                            |
| `01-posts-public.md`    | `POST`  | Posts data model, markdown, public post page & home     |
| `02-admin-authoring.md` | `ADM`   | Editor, drafts, preview, scheduling, cron               |
| `03-search.md`          | `SRCH`  | Categories, tags, search                                |
| `04-comments.md`        | `CMT`   | Comment tree, moderation, rate limits, log              |
| `05-likes.md`           | `LIKE`  | Likes on posts and comments                             |
| `06-announcements.md`   | `ANN`   | Admin announcements                                     |
| `07-analytics.md`       | `ANLY`  | View tracking + admin dashboard                         |
| `08-seo-launch.md`      | `SEO`   | Metadata, sitemap, mobile QA, launch                    |
| `09-accounts.md`        | `ACCT`  | Account self-service (deletion, anonymization)          |
| `10-brand.md`           | `BRAND` | Visual identity: theme, icons, wordmark, OG card        |
| `11-revisions.md`       | `REV`   | Revision history, diffs, restore                        |
| `12-feed.md`            | `FEED`  | RSS feed for reader subscriptions                       |
| `13-simplify.md`        | `SIMP`  | Feature simplicity scan: keep / simplify / drop         |
| `14-media.md`           | `MEDIA` | Image uploads via Vercel Blob (thumbnail, banner, body) |

## Priority (set 2026-08-27)

Open work, in the order to pick it up. Overrides the epic-table order while any of these are open.

1. **SEO-10** — home-page canonical (Search Console duplicate report). Bug; one small PR.
2. **FEED-1..3** — RSS feed. Small, reader-facing; bank it before the big epic.
3. **SIMP-1..2** — feature simplicity scan (audit doc, then Paul picks cuts) — runs before REV so it can prune scope first.
4. **POST-11** — linkable headings. Quick hitter; bank it before the big epic.
5. **REV-1..6** — revisions. Largest open epic and author-only; nothing is blocked on it.
6. **MEDIA-1..4** — image uploads.

Tie-break rules Paul set: bugs before features, then small before large.

## Working the backlog

- `/task next` or `$task next` ([shared workflow](../docs/harness/workflows/task.md)) picks the first unblocked todo in build order (the Priority list above wins while it has open items). `/task FND-3` runs a specific one.
- Later epics are intentionally lighter — flesh out a task's acceptance criteria when you reach it, referencing the relevant FR-x.y and technical-design section.
