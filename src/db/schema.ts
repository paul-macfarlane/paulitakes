// Drizzle schema. Auth tables are managed by Better Auth via its Drizzle
// adapter; `user` is extended with `role` and `banned_at` (design §4).
// Application tables land with their epics (posts/POST, comments/CMT, ...).

import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  customType,
  check,
  uniqueIndex,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  ProposalSnapshot,
  ProposalNotes,
  SkillAttribution,
  ProposalStatus,
} from "@/lib/proposals/input";
import type { ProposalDiff } from "@/lib/proposals/diff";

import type { ModVerdictRecord } from "@/lib/comments/verdict";

// drizzle-orm ^0.45 has no built-in tsvector column type; define one custom
// type used by the generated `search` column on `posts` (design §4).
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const userRole = pgEnum("user_role", ["reader", "author", "admin"]);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("reader"),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // The admin user list (ADM-8/10) orders by created_at and filters by role.
  (table) => [
    index("user_created_at_idx").on(table.createdAt),
    index("user_role_idx").on(table.role),
  ],
);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Posts domain (design §4, POST-1).

export const postStatus = pgEnum("post_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // RESTRICT (no onDelete) is deliberate: account deletion must explicitly
    // transfer (transferPostsOwnership) or delete (deleteNeverPublicPostsForUser)
    // a user's authored posts first — the FK fails loudly if a post still
    // references the user mid-deletion, rather than silently orphaning it.
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    // Mutable editor identity, including lifecycle/ownership changes (ADR-0030).
    editVersion: uuid("edit_version")
      .notNull()
      .defaultRandom()
      .$onUpdate(() => crypto.randomUUID()),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    bodyMd: text("body_md").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    // Post-page hero (POST-9); null falls back to thumbnailUrl.
    bannerUrl: text("banner_url"),
    videoUrl: text("video_url"),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    status: postStatus("status").notNull().default("draft"),
    commentsLocked: boolean("comments_locked").notNull().default(false),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    archiveAt: timestamp("archive_at", { withTimezone: true }),
    // Stamped ONLY when staged edits are promoted to a publicly-visible post
    // (promoteStagedDraft) — drives the public "Updated" byline. Deliberately
    // not $onUpdate: updatedAt bumps on every row write, including status
    // transitions that re-stamp publishAt with no content change (ADR-0016).
    contentUpdatedAt: timestamp("content_updated_at", { withTimezone: true }),
    // Staged content edits for an already-public post (draft-of-published,
    // ADR-0011) live in the normalized post_drafts table below, not a column
    // here — see ADR-0012 for why the jsonb buffer was normalized.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Better Auth maintains updatedAt on its own tables; for posts, Drizzle
    // sets it on every db.update() via $onUpdate.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('english', ${posts.title}), 'A') || setweight(to_tsvector('english', ${posts.bodyMd}), 'B')`,
      ),
  },
  (table) => [
    index("posts_search_idx").using("gin", table.search),
    // Serves visiblePostsWhere(): status equality list + publish_at range.
    // Does NOT cover the revalidation cron's publish_at/archive_at crossing
    // scans — those stay seq scans until the table outgrows blog scale.
    index("posts_status_publish_at_idx").on(table.status, table.publishAt),
    // FK companion indexes: category pages filter by category_id; authors
    // are scoped to their own rows in /admin (author_id).
    index("posts_category_id_idx").on(table.categoryId),
    index("posts_author_id_idx").on(table.authorId),
  ],
);

// Staged content edits for an already-public post (draft-of-published,
// ADR-0011), normalized into its own 1:1 table (ADR-0012 — was a jsonb
// column on `posts`). `postId` is the PK: a row existing IS "this post has
// pending changes" (no separate null-vs-present flag needed), and cascades
// away if the post is deleted. Shape mirrors postDraftSchema
// (src/lib/posts/input.ts), the validation source of truth.
export const postDrafts = pgTable("post_drafts", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  bodyMd: text("body_md").notNull(),
  thumbnailUrl: text("thumbnail_url").notNull(),
  bannerUrl: text("banner_url"),
  videoUrl: text("video_url"),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  // Tag NAMES, not tag rows: real tag rows are only created (via
  // setPostTags) when the draft is promoted, so discarding/deleting a draft
  // never leaves orphan tags behind.
  tags: text("tags").array().notNull(),
  // Display/audit timestamp. The parent editVersion guards saves and
  // publish/discard, including multiple changes within one millisecond.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    // The composite PK leads with post_id; tag-side lookups (tag pages,
    // tag-delete cascade) need their own index.
    index("post_tags_tag_id_idx").on(table.tagId),
  ],
);

// Comments domain (design §4, §5.2, §5.3, CMT-1).

export const commentStatus = pgEnum("comment_status", [
  "visible",
  "held",
  "rejected",
  "deleted",
]);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Admin hard-delete of a post cascades to its comments (design §5.7).
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    // Nullable (unlike posts.authorId): self-service account deletion
    // (ACCT-1) anonymizes a deleting user's comments to author_id = NULL
    // rather than blocking on them. No onDelete though — the FK deliberately
    // stays RESTRICT, so any comment that ISN'T anonymized first (a bug, or a
    // row inserted mid-anonymize) still fails the user delete loudly instead
    // of silently orphaning it.
    authorId: text("author_id").references(() => user.id),
    // Self-FK, null = top-level (design §4). No cascade: hard deletes are
    // only ever performed on childless comments — the child-existence check
    // and delete semantics live in the service layer, not the FK.
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id),
    body: text("body").notNull(),
    // No default: every insert states its moderation outcome explicitly
    // (design §5.2 step 4).
    status: commentStatus("status").notNull(),
    // Audit record { verdict, reason, model, latencyMs } | { error, model,
    // latencyMs } stored on every comment (design §5.2 step 5).
    modVerdict: jsonb("mod_verdict").$type<ModVerdictRecord>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (table) => [
    // Comment tree reads (design §5.3).
    index("comments_post_id_created_at_idx").on(table.postId, table.createdAt),
    // Moderation log (design §5.2).
    index("comments_status_created_at_idx").on(table.status, table.createdAt),
    // Per-author rate-limit counts in the last minute/hour (design §5.2 step
    // 2) — beyond the design's two listed indexes, needed so those COUNTs
    // don't seq-scan.
    index("comments_author_id_created_at_idx").on(
      table.authorId,
      table.createdAt,
    ),
    // Child-existence check on delete (service layer, design §5.7-style hard
    // delete semantics).
    index("comments_parent_id_idx").on(table.parentId),
  ],
);

// Likes domain (design §4, §5.4, FR-5.1). Both tables are pure join rows with
// no content of their own, so — unlike posts/comments authorId — the user_id
// FK cascades too (mirrors post_tags): there's nothing worth failing loudly
// over if the liking user is gone.

export const postLikes = pgTable(
  "post_likes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite PK makes "one like per user per post" structural and the
    // toggle idempotent (design §5.4), rather than an app-level check.
    primaryKey({ columns: [table.postId, table.userId] }),
    // FK companion index for the user-side cascade path — Postgres doesn't
    // index referencing columns automatically (same reason as
    // post_tags_tag_id_idx).
    index("post_likes_user_id_idx").on(table.userId),
  ],
);

export const commentLikes = pgTable(
  "comment_likes",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite PK makes "one like per user per comment" structural and the
    // toggle idempotent (design §5.4), rather than an app-level check.
    primaryKey({ columns: [table.commentId, table.userId] }),
    // FK companion index for the user-side cascade path — Postgres doesn't
    // index referencing columns automatically (same reason as
    // post_tags_tag_id_idx).
    index("comment_likes_user_id_idx").on(table.userId),
  ],
);

// Announcements domain (design §4, FR-6.1, FR-6.3): short, admin-authored
// site-wide messages with minimal markdown and an optional expiration.
export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ≤500 chars enforced at the input layer (announcementInputSchema), not the
  // column type — repo convention is text everywhere (design §4).
  body: text("body").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Analytics domain (design §4, §5.6, ANLY-1): one row per beacon.
export const pageViews = pgTable(
  "page_views",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Nullable: null = a non-post page (home, tags, account, ...). set null
    // (not cascade) so an admin hard-delete of a post doesn't erase the
    // site-traffic history it already generated — traffic-over-time (design
    // §5.6) must stay accurate even after the post is gone.
    postId: uuid("post_id").references(() => posts.id, {
      onDelete: "set null",
    }),
    path: text("path").notNull(),
    // Salted daily hash, no PII (design §8) — never raw IP/user-agent.
    visitorHash: text("visitor_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Per-post traffic-over-time queries (design §5.6 dashboard).
    index("page_views_post_id_created_at_idx").on(
      table.postId,
      table.createdAt,
    ),
    // Site-wide traffic-over-time (no post filter).
    index("page_views_created_at_idx").on(table.createdAt),
  ],
);

// Single-row state for the ADM-9 revalidation cron (design §4): the last time
// it ran, so the window of crossed publish_at/archive_at is computed from the
// DB rather than trusted from call timing (idempotent to missed/duplicated
// triggers). `id` is a fixed boolean, so the table holds exactly one row.
export const revalidationState = pgTable("revalidation_state", {
  id: boolean("id").primaryKey().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Immutable review artifacts; closing a proposal only changes its decision
// columns. Deleting a post removes its retained proposals with the article.
export const editProposals = pgTable(
  "edit_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    origin: text("origin").notNull().default("agent"),
    agentId: text("agent_id").notNull(),
    agentLabel: text("agent_label").notNull(),
    skill: jsonb("skill").$type<SkillAttribution>().notNull(),
    sourceVersion: uuid("source_version").notNull(),
    sourceIsPublic: boolean("source_is_public").notNull(),
    base: jsonb("base").$type<ProposalSnapshot>().notNull(),
    candidate: jsonb("candidate").$type<ProposalSnapshot>().notNull(),
    diff: jsonb("diff").$type<ProposalDiff>().notNull(),
    notes: jsonb("notes").$type<ProposalNotes>().notNull(),
    status: text("status")
      .$type<(typeof ProposalStatus)[keyof typeof ProposalStatus]>()
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    acceptedChangeIds: jsonb("accepted_change_ids").$type<string[]>(),
    rejectedChangeIds: jsonb("rejected_change_ids").$type<string[]>(),
    appliedVersion: uuid("applied_version"),
  },
  (table) => [
    index("edit_proposals_post_created_idx").on(table.postId, table.createdAt),
    uniqueIndex("edit_proposals_one_open_agent_idx")
      .on(table.postId)
      .where(sql`${table.status} = 'open' AND ${table.origin} = 'agent'`),
    check(
      "edit_proposals_status_check",
      sql`${table.status} in ('open', 'applied', 'rejected', 'superseded')`,
    ),
    check("edit_proposals_origin_check", sql`${table.origin} = 'agent'`),
    check(
      "edit_proposals_decision_check",
      sql`(${table.status} = 'open' AND ${table.decidedAt} is null) OR (${table.status} <> 'open' AND ${table.decidedAt} is not null)`,
    ),
  ],
);

// One stable API principal holds durable quota state; no credentials are stored.
export const agentApiState = pgTable(
  "agent_api_state",
  {
    id: uuid("id").primaryKey(),
    readWindow: timestamp("read_window", { withTimezone: true }),
    readCount: integer("read_count").notNull().default(0),
    submitWindow: timestamp("submit_window", { withTimezone: true }),
    submitCount: integer("submit_count").notNull().default(0),
  },
  (table) => [
    check(
      "agent_api_state_counts_check",
      sql`${table.readCount} >= 0 AND ${table.submitCount} >= 0`,
    ),
  ],
);

// Receipts hold no article text. A deleted proposal leaves a tombstone so
// retrying an old successful key can never recreate the deleted artifact.
export const agentReceipts = pgTable(
  "agent_receipts",
  {
    principalId: uuid("principal_id").notNull(),
    key: uuid("key").notNull(),
    requestHash: text("request_hash").notNull(),
    postId: uuid("post_id").notNull(),
    proposalId: uuid("proposal_id").references(() => editProposals.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.key] }),
    index("agent_receipts_proposal_idx").on(table.proposalId),
  ],
);
