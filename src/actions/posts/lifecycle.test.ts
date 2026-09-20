import { freshPostUpdater } from "@/test/helpers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  registerPostSuiteLifecycle,
  seedPost as seedPostFixture,
  sessionSetters,
  sessionUser,
  type StaffFixtureIds,
} from "@/test/helpers";

// vi.hoisted lifts this above the mock factories below (TDZ otherwise) —
// one pool/db serves both the mocked "@/db" (used by the actions under
// test) and the seeding/cleanup code here.
const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});

vi.mock("@/db", () => ({ db: testDb }));

const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
  requireStaff: async () => {
    throw new Error("requireStaff is unmocked — actions must use getSession");
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

// updatePost is imported only to ARRANGE staged changes on a published post
// for the pending-changes guard tests below — the actions under test in
// this file are the lifecycle transitions. See crud.test.ts for updatePost's
// own staging behavior and draft.test.ts for publishPostChanges/
// discardPostChanges.
const { updatePost: updateVersionedPost } = await import("./crud");
const updatePost = freshPostUpdater(testDb, updateVersionedPost);
const {
  transitionPostStatus,
  schedulePublish,
  scheduleArchive,
  cancelScheduledArchive,
} = await import("./lifecycle");
const { revalidateTag } = await import("next/cache");

const { posts } = schema;

const SEED_PREFIX = "t-adm3c-";

let ids: StaffFixtureIds;
const { authorSession, adminSession, readerSession, noSession } =
  sessionSetters(sessionMock, () => ids);

const { runId } = registerPostSuiteLifecycle({
  testDb,
  pool,
  prefix: SEED_PREFIX,
  onSeeded: (seededIds) => {
    ids = seededIds;
  },
});

describe("transitionPostStatus", () => {
  const HTTPS_THUMB = "https://img.example.com/thumb.jpg";

  function seedPost(opts: {
    suffix: string;
    status: "draft" | "scheduled" | "published" | "archived";
    thumbnailUrl?: string;
    authorId?: string;
    archiveAt?: Date | null;
  }) {
    return seedPostFixture(testDb, {
      runId,
      suffix: opts.suffix,
      authorId: opts.authorId ?? ids.authorId,
      categoryId: ids.categoryId,
      bodyMd: "Body.",
      thumbnailUrl: opts.thumbnailUrl ?? "",
      status: opts.status,
      archiveAt: opts.archiveAt ?? null,
    });
  }

  it("publishes a draft with a thumbnail: sets published, publish_at, clears archive_at, revalidates", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const post = await seedPost({
      suffix: "publish-ok",
      status: "draft",
      thumbnailUrl: HTTPS_THUMB,
      archiveAt: future,
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await transitionPostStatus(post.id, "published");
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, status: "published" },
    });

    const [row] = await testDb
      .select({
        status: posts.status,
        publishAt: posts.publishAt,
        archiveAt: posts.archiveAt,
      })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("published");
    expect(row!.publishAt).not.toBeNull();
    expect(row!.publishAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row!.archiveAt).toBeNull();

    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
    expect(revalidateTag).toHaveBeenCalledWith(
      `post:${post.slug}`,
      expect.anything(),
    );
  });

  it("blocks publishing a post with no thumbnail (publish-time validation)", async () => {
    const post = await seedPost({
      suffix: "publish-no-thumb",
      status: "draft",
      thumbnailUrl: "",
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await transitionPostStatus(post.id, "published");
    expect(result).toEqual({
      ok: false,
      error: "Add a thumbnail image before publishing.",
    });

    const [row] = await testDb
      .select({ status: posts.status })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("draft");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("archives a published post and clears a pending scheduled archive_at", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const post = await seedPost({
      suffix: "archive",
      status: "published",
      thumbnailUrl: HTTPS_THUMB,
      archiveAt: future,
    });
    authorSession();

    const result = await transitionPostStatus(post.id, "archived");
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("archived");
    // The manual archive fulfills the schedule; a stale future archive_at
    // would otherwise trigger a pointless cron revalidation later.
    expect(row!.archiveAt).toBeNull();
  });

  it("restoring an archived post to published preserves its original publish date", async () => {
    // A post published last week, then archived: restoring keeps the date
    // (and feed position), it does not jump to 'now' (FR-1.6).
    const originalPublish = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: ids.authorId,
        title: `${runId} restore-published`,
        slug: `${runId}-restore-published`,
        bodyMd: "Body.",
        thumbnailUrl: HTTPS_THUMB,
        categoryId: ids.categoryId,
        status: "archived",
        publishAt: originalPublish,
      })
      .returning({ id: posts.id });
    authorSession();

    const result = await transitionPostStatus(post!.id, "published");
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row!.status).toBe("published");
    expect(row!.publishAt!.getTime()).toBe(originalPublish.getTime());
  });

  it("restores an archived post to draft, clearing a pending archive_at", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const post = await seedPost({
      suffix: "restore-draft",
      status: "archived",
      thumbnailUrl: HTTPS_THUMB,
      archiveAt: past,
    });
    authorSession();

    const result = await transitionPostStatus(post.id, "draft");
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, status: "draft" },
    });

    const [row] = await testDb
      .select({ status: posts.status, archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("draft");
    expect(row!.archiveAt).toBeNull();
  });

  it("re-publishing a drafted post stamps now(), not its stale prior publish date", async () => {
    // published -> draft leaves a week-old publish_at on the draft; hitting
    // Publish now must surface it as newly published, not backdated (only an
    // archived-restore preserves the old date).
    const stale = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [post] = await testDb
      .insert(posts)
      .values({
        authorId: ids.authorId,
        title: `${runId} republish-draft`,
        slug: `${runId}-republish-draft`,
        bodyMd: "Body.",
        thumbnailUrl: HTTPS_THUMB,
        categoryId: ids.categoryId,
        status: "draft",
        publishAt: stale,
      })
      .returning({ id: posts.id });
    authorSession();

    const before = Date.now();
    const result = await transitionPostStatus(post!.id, "published");
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post!.id));
    expect(row!.publishAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row!.publishAt!.getTime()).not.toBe(stale.getTime());
  });

  it("rejects a disallowed transition (archived -> archived is caught as no-op; publish->scheduled routed to scheduling)", async () => {
    // 'scheduled' is intercepted before the transition matrix (needs a
    // timestamp), so published->scheduled returns the scheduling hint.
    const scheduledTarget = await seedPost({
      suffix: "bad-transition",
      status: "published",
      thumbnailUrl: HTTPS_THUMB,
    });
    authorSession();
    expect(await transitionPostStatus(scheduledTarget.id, "scheduled")).toEqual(
      {
        ok: false,
        error: "Use schedule publish to set a publish time.",
      },
    );
  });

  it("rejects an unknown target status", async () => {
    const post = await seedPost({ suffix: "bad-status", status: "draft" });
    authorSession();

    const result = await transitionPostStatus(post.id, "deleted");
    expect(result).toEqual({ ok: false, error: "Invalid status." });
  });

  it("is idempotent: transitioning to the current status succeeds without revalidating", async () => {
    const post = await seedPost({ suffix: "idempotent", status: "draft" });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await transitionPostStatus(post.id, "draft");
    expect(result).toEqual({
      ok: true,
      data: { id: post.id, status: "draft" },
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a non-owner author but allows an admin", async () => {
    const post = await seedPost({
      suffix: "status-owner-check",
      status: "draft",
      thumbnailUrl: HTTPS_THUMB,
    });

    // A different author (staff, but not the owner).
    sessionMock.current = sessionUser(ids.readerId, "author");
    const nonOwner = await transitionPostStatus(post.id, "archived");
    expect(nonOwner).toEqual({ ok: false, error: "Not authorized." });

    adminSession();
    const asAdmin = await transitionPostStatus(post.id, "archived");
    expect(asAdmin.ok).toBe(true);
  });

  it("rejects a reader and an unauthenticated caller", async () => {
    const post = await seedPost({ suffix: "authz", status: "draft" });

    readerSession();
    expect(await transitionPostStatus(post.id, "archived")).toEqual({
      ok: false,
      error: "Not authorized.",
    });

    noSession();
    expect(await transitionPostStatus(post.id, "archived")).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });

  it("returns 'Post not found.' for an unknown id", async () => {
    authorSession();
    const result = await transitionPostStatus(
      "00000000-0000-4000-8000-000000000000",
      "archived",
    );
    expect(result).toEqual({ ok: false, error: "Post not found." });
  });

  it("compare-and-swap rejects a stale write when the status changed concurrently", async () => {
    const post = await seedPost({
      suffix: "cas-conflict",
      status: "draft",
      thumbnailUrl: HTTPS_THUMB,
    });
    authorSession();

    // Hold a row lock so the action reads 'draft' then blocks on its guarded
    // UPDATE; flip the status underneath it and release. The UPDATE's
    // `WHERE status = 'draft'` then matches zero rows -> conflict.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from posts where id = $1 for update", [
        post.id,
      ]);
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      const holderPid = pidRows[0]!.pid;

      const actionPromise = transitionPostStatus(post.id, "published");

      // Deterministic (not a timing guess): wait until the action's guarded
      // UPDATE is actually blocked on OUR row lock — by then its non-locking
      // SELECT has already read 'draft'. Scoped via pg_blocking_pids to
      // backends blocked by this connection specifically: a global "any
      // ungranted lock" check (the previous version) could be satisfied by a
      // concurrently running test file's transient lock, releasing the flip
      // too early and letting the CAS succeed instead of conflicting.
      // Two constraints shape the polling:
      // - it MUST run on `client`: the shared test pool is max:2, and with
      //   the lock holder + the blocked action both checked out, a
      //   pool.query() poll would queue forever behind the very statement
      //   it's waiting on;
      // - `client` has a transaction open, and pg_stat_activity freezes to a
      //   snapshot at its first in-transaction read — the action's backend
      //   may be a pool connection created after that snapshot, so each
      //   iteration clears it first.
      for (let i = 0; ; i++) {
        await client.query("select pg_stat_clear_snapshot()");
        const { rows } = await client.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
          [holderPid],
        );
        if (rows[0]!.n > 0) break;
        if (i >= 400)
          throw new Error("action UPDATE never blocked on the lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      await client.query("update posts set status = 'archived' where id = $1", [
        post.id,
      ]);
      await client.query("commit");

      expect(await actionPromise).toEqual({
        ok: false,
        error: "This post was changed elsewhere. Reload and try again.",
      });
    } finally {
      client.release();
    }
  });
});

describe("schedulePublish / scheduleArchive / cancelScheduledArchive", () => {
  const HTTPS_THUMB = "https://img.example.com/thumb.jpg";
  const DAY = 24 * 60 * 60 * 1000;

  function seedPost(opts: {
    suffix: string;
    status: "draft" | "scheduled" | "published" | "archived";
    thumbnailUrl?: string;
    publishAt?: Date | null;
    archiveAt?: Date | null;
  }) {
    return seedPostFixture(testDb, {
      runId,
      suffix: opts.suffix,
      authorId: ids.authorId,
      categoryId: ids.categoryId,
      bodyMd: "Body.",
      thumbnailUrl: opts.thumbnailUrl ?? HTTPS_THUMB,
      status: opts.status,
      publishAt: opts.publishAt ?? null,
      archiveAt: opts.archiveAt ?? null,
    });
  }

  it("schedules a future publish on a draft: status becomes scheduled with publish_at set", async () => {
    const post = await seedPost({ suffix: "sched-pub", status: "draft" });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const when = new Date(Date.now() + DAY);
    const result = await schedulePublish(post.id, when.toISOString());
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("scheduled");
    expect(row!.publishAt!.getTime()).toBe(when.getTime());
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });

  it("rejects a publish time in the past", async () => {
    const post = await seedPost({ suffix: "sched-past", status: "draft" });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() - DAY).toISOString(),
    );
    expect(result).toEqual({
      ok: false,
      error: "Publish time must be in the future.",
    });
  });

  it("blocks scheduling a publish with no thumbnail", async () => {
    const post = await seedPost({
      suffix: "sched-no-thumb",
      status: "draft",
      thumbnailUrl: "",
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result).toEqual({
      ok: false,
      error: "Add a thumbnail image before scheduling a publish.",
    });
  });

  it("refuses to reschedule a scheduled post that is already live (publish_at passed)", async () => {
    const post = await seedPost({
      suffix: "sched-live",
      status: "scheduled",
      // publish_at in the past => currently visible via the predicate.
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result).toEqual({
      ok: false,
      error: "This post is already live. Archive it before rescheduling.",
    });

    // The live post's publish_at must be untouched.
    const [row] = await testDb
      .select({ publishAt: posts.publishAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.publishAt!.getTime()).toBeLessThan(Date.now());
  });

  it("cannot schedule a publish for a published post", async () => {
    const post = await seedPost({
      suffix: "sched-published",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Cannot schedule");
  });

  it("rejects a publish time at/after a pending scheduled archive", async () => {
    const archiveAt = new Date(Date.now() + DAY);
    const post = await seedPost({
      suffix: "sched-pub-after-archive",
      status: "scheduled",
      publishAt: new Date(Date.now() + 60_000),
      archiveAt,
    });
    authorSession();

    const result = await schedulePublish(
      post.id,
      new Date(archiveAt.getTime() + DAY).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("scheduled archive");
  });

  it("schedules a future archive on a published post", async () => {
    const post = await seedPost({
      suffix: "sched-arch",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const when = new Date(Date.now() + DAY);
    const result = await scheduleArchive(post.id, when.toISOString());
    expect(result.ok).toBe(true);

    const [row] = await testDb
      .select({ status: posts.status, archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    // Status is untouched — visibility flips only when archive_at passes.
    expect(row!.status).toBe("published");
    expect(row!.archiveAt!.getTime()).toBe(when.getTime());
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });

  it("rejects an archive time at/before the publish time", async () => {
    const publishAt = new Date(Date.now() + DAY);
    const post = await seedPost({
      suffix: "arch-before-pub",
      status: "scheduled",
      publishAt,
    });
    authorSession();

    const result = await scheduleArchive(
      post.id,
      new Date(publishAt.getTime() - 60_000).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("after the publish time");
  });

  it("cannot schedule an archive for a draft", async () => {
    const post = await seedPost({ suffix: "arch-draft", status: "draft" });
    authorSession();

    const result = await scheduleArchive(
      post.id,
      new Date(Date.now() + DAY).toISOString(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Cannot schedule an archive");
  });

  it("rejects an invalid date input", async () => {
    const post = await seedPost({ suffix: "bad-date", status: "draft" });
    authorSession();

    const result = await schedulePublish(post.id, "not-a-date");
    expect(result).toEqual({
      ok: false,
      error: "Enter a valid date and time.",
    });
  });

  it("cancels a pending scheduled archive, clearing archive_at", async () => {
    const post = await seedPost({
      suffix: "cancel-arch",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
      archiveAt: new Date(Date.now() + DAY),
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await cancelScheduledArchive(post.id);
    expect(result).toEqual({ ok: true, data: { id: post.id } });

    const [row] = await testDb
      .select({ archiveAt: posts.archiveAt })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.archiveAt).toBeNull();
    expect(revalidateTag).toHaveBeenCalledWith("post-list", expect.anything());
  });

  it("cancel is idempotent when nothing is scheduled (no write, no revalidate)", async () => {
    const post = await seedPost({
      suffix: "cancel-none",
      status: "published",
      publishAt: new Date(Date.now() - DAY),
    });
    authorSession();
    vi.mocked(revalidateTag).mockClear();

    const result = await cancelScheduledArchive(post.id);
    expect(result).toEqual({ ok: true, data: { id: post.id } });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a reader and an unauthenticated caller", async () => {
    const post = await seedPost({ suffix: "sched-authz", status: "draft" });
    const when = new Date(Date.now() + DAY).toISOString();

    readerSession();
    expect(await schedulePublish(post.id, when)).toEqual({
      ok: false,
      error: "Not authorized.",
    });

    noSession();
    expect(await scheduleArchive(post.id, when)).toEqual({
      ok: false,
      error: "Not authorized.",
    });
  });
});

// Pending-changes lifecycle guard (ADR-0011): a public post with staged
// edits must have them promoted or discarded before any lifecycle move. See
// crud.test.ts for updatePost's own staging behavior and draft.test.ts for
// publishPostChanges/discardPostChanges.
describe("staged draft edits (draft-of-published, ADR-0011)", () => {
  function seedPublished(suffix: string) {
    return seedPostFixture(testDb, {
      runId,
      suffix,
      authorId: ids.authorId,
      categoryId: ids.categoryId,
      bodyMd: "Live body.",
      thumbnailUrl: "https://img.example.com/live.jpg",
      status: "published",
      publishAt: new Date(Date.now() - 1000),
    });
  }

  it("blocks a status transition while the post has staged changes", async () => {
    const post = await seedPublished("guard-transition");
    authorSession();
    await updatePost(post.id, { title: `${runId} guarded` });

    const result = await transitionPostStatus(post.id, "draft");
    expect(result).toEqual({
      ok: false,
      error: "Publish or discard your pending changes first.",
    });
    const [row] = await testDb
      .select({ status: posts.status })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row!.status).toBe("published");
  });

  it("blocks scheduling an archive while the post has staged changes", async () => {
    const post = await seedPublished("guard-schedule");
    authorSession();
    await updatePost(post.id, { title: `${runId} guarded sched` });

    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const result = await scheduleArchive(post.id, future);
    expect(result).toEqual({
      ok: false,
      error: "Publish or discard your pending changes first.",
    });
  });
});
