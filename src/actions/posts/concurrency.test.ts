import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { posts } from "@/db/schema";
import {
  draftRowLoader,
  loadEditVersion,
  registerPostSuiteLifecycle,
  seedPost,
  sessionSetters,
  type StaffFixtureIds,
} from "@/test/helpers";

const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});
vi.mock("@/db", () => ({ db: testDb }));
const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { updatePost } = await import("./crud");
const { discardPostChanges, publishPostChanges } = await import("./draft");
const { transitionPostStatus } = await import("./lifecycle");
const { getEditablePost } = await import("@/lib/posts/admin");
const { writePostColumns, transferPostsOwnership } =
  await import("@/lib/posts/data");
const { setPostCommentsLockedColumn } = await import("@/lib/comments/data");
const { revalidateTag } = await import("next/cache");
let ids: StaffFixtureIds;
const { authorSession, readerSession, noSession } = sessionSetters(
  sessionMock,
  () => ids,
);
const { runId } = registerPostSuiteLifecycle({
  testDb,
  pool,
  prefix: "t-air2-",
  onSeeded: (value) => {
    ids = value;
  },
});
const loadDraft = draftRowLoader(testDb);
const conflict = { ok: false, code: "conflict" };
async function seed(suffix: string, published = false) {
  authorSession();
  return seedPost(testDb, {
    runId,
    suffix,
    authorId: ids.authorId,
    categoryId: ids.categoryId,
    bodyMd: "Original body.",
    thumbnailUrl: "https://example.com/thumbnail.png",
    status: published ? "published" : "draft",
    publishAt: published ? new Date(Date.now() - 60000) : null,
  });
}
async function editVersion(id: string) {
  return loadEditVersion(testDb, id);
}

describe("editor version contract", () => {
  it("keeps comment moderation independent of unsaved editorial content", async () => {
    const post = await seed("comment-lock");
    const base = await editVersion(post.id);
    expect(await setPostCommentsLockedColumn(post.id, true)).toBe(true);
    expect(await editVersion(post.id)).toBe(base);
    expect(
      await updatePost(post.id, { bodyMd: "Unsaved editorial work." }, base),
    ).toMatchObject({ ok: true });
    const [row] = await testDb
      .select()
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(row.commentsLocked).toBe(true);
    expect(row.bodyMd).toBe("Unsaved editorial work.");
  });

  it.each([false, true])(
    "rejects sequential stale saves, including empty payloads (public=%s)",
    async (published) => {
      const post = await seed(`sequential-${published}`, published);
      const base = await editVersion(post.id);
      const editable = await getEditablePost(post.id, {
        id: ids.authorId,
        role: "author",
      });
      expect(editable?.editVersion).toBe(base);
      const saved = await updatePost(
        post.id,
        { bodyMd: "First editor." },
        base,
      );
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.data.editVersion).not.toBe(base);
      vi.mocked(revalidateTag).mockClear();
      for (const input of [
        { title: "Stale metadata" },
        { bodyMd: "Stale body" },
        {},
      ]) {
        expect(await updatePost(post.id, input, base)).toMatchObject(conflict);
      }
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(await editVersion(post.id)).toBe(saved.data.editVersion);
      expect(
        (await getEditablePost(post.id, { id: ids.authorId, role: "author" }))
          ?.bodyMd,
      ).toBe("First editor.");
      const [live] = await testDb
        .select()
        .from(posts)
        .where(eq(posts.id, post.id));
      expect(live.bodyMd).toBe(published ? "Original body." : "First editor.");
      const next = await updatePost(
        post.id,
        { title: "Next fresh edit" },
        saved.data.editVersion,
      );
      expect(next.ok).toBe(true);
    },
  );

  it.each([false, true])(
    "allows exactly one concurrent save from the same version (public=%s)",
    async (published) => {
      const post = await seed(`simultaneous-${published}`, published);
      const base = await editVersion(post.id);
      const results = await Promise.all([
        updatePost(post.id, { bodyMd: "Editor A" }, base),
        updatePost(post.id, { bodyMd: "Editor B" }, base),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toMatchObject(conflict);
    },
  );

  it("rejects a stale save over an existing pending snapshot and preserves the live post", async () => {
    const post = await seed("existing-stage", true);
    const first = await updatePost(
      post.id,
      { title: "Pending title" },
      await editVersion(post.id),
    );
    expect(first.ok).toBe(true);
    const base = await editVersion(post.id);
    expect(
      (await updatePost(post.id, { bodyMd: "New pending body" }, base)).ok,
    ).toBe(true);
    expect(await updatePost(post.id, { tags: ["stale"] }, base)).toMatchObject(
      conflict,
    );
    expect((await loadDraft(post.id))?.bodyMd).toBe("New pending body");
  });

  it.each(["discard", "promote", "revert"])(
    "invalidates older editors after %s",
    async (operation) => {
      const post = await seed(`invalidate-${operation}`, true);
      const original = await editVersion(post.id);
      expect(
        (await updatePost(post.id, { bodyMd: "Pending" }, original)).ok,
      ).toBe(true);
      const pending = await editVersion(post.id);
      const result =
        operation === "discard"
          ? await discardPostChanges(post.id)
          : operation === "promote"
            ? await publishPostChanges(post.id)
            : await updatePost(post.id, { bodyMd: "Original body." }, pending);
      expect(result.ok).toBe(true);
      expect(await editVersion(post.id)).not.toBe(original);
      expect(await editVersion(post.id)).not.toBe(pending);
      expect(await loadDraft(post.id)).toBeUndefined();
      expect(
        await updatePost(post.id, { bodyMd: "Stale original tab" }, original),
      ).toMatchObject(conflict);
      expect(
        await updatePost(post.id, { bodyMd: "Stale pending tab" }, pending),
      ).toMatchObject(conflict);
    },
  );

  it.each([false, true])(
    "preserves the version on a fresh no-op; tags-only changes advance it (public=%s)",
    async (published) => {
      const post = await seed(`no-op-tags-${published}`, published);
      const base = await editVersion(post.id);
      expect(await updatePost(post.id, {}, base)).toMatchObject({
        ok: true,
        data: { editVersion: base },
      });
      const result = await updatePost(
        post.id,
        { tags: [`${runId}-versioned-tag`] },
        base,
      );
      expect(result.ok).toBe(true);
      expect(await editVersion(post.id)).not.toBe(base);
    },
  );

  it("invalidates on publish and transfer without granting the former owner access", async () => {
    const post = await seed("lifecycle-transfer");
    const base = await editVersion(post.id);
    expect((await transitionPostStatus(post.id, "published")).ok).toBe(true);
    expect(
      await updatePost(post.id, { bodyMd: "Before publishing" }, base),
    ).toMatchObject(conflict);
    const published = await editVersion(post.id);
    await transferPostsOwnership(ids.authorId, ids.adminId);
    expect(await editVersion(post.id)).not.toBe(published);
    expect(
      await updatePost(post.id, { bodyMd: "Old owner" }, published),
    ).toMatchObject({ ok: false, error: "Not authorized." });
  });

  it("refuses the direct-write destination after a scheduled post becomes visible", async () => {
    const post = await seed("clock-crossing", true);
    const base = await editVersion(post.id);
    // Models a request that selected direct-write before the publish boundary.
    expect(
      await writePostColumns(
        post.id,
        { bodyMd: "Should stage" },
        { expectedVersion: base, guardThumbnailInvariant: false },
      ),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(await editVersion(post.id)).toBe(base);
  });

  it("returns the effective staged slug on an unchanged flush", async () => {
    const post = await seed("staged-slug-noop", true);
    const saved = await updatePost(
      post.id,
      { slug: `${runId}-new-staged-slug` },
      await editVersion(post.id),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(await updatePost(post.id, {}, saved.data.editVersion)).toEqual(
      saved,
    );
  });

  it("rejects malformed versions and checks session/role before version validation", async () => {
    const post = await seed("auth-input");
    expect(await updatePost(post.id, {}, "not-a-version")).toMatchObject({
      ok: false,
      error: "Reload this editor before saving.",
    });
    for (const setSession of [readerSession, noSession]) {
      setSession();
      expect(await updatePost("invalid", {}, "invalid")).toMatchObject({
        ok: false,
        error: "Not authorized.",
      });
    }
  });
});
