import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { editProposals, posts } from "@/db/schema";
import {
  draftRowLoader,
  loadEditVersion,
  registerPostSuiteLifecycle,
  seedPost,
  sessionSetters,
  type StaffFixtureIds,
} from "@/test/helpers";
import {
  proposalSnapshotSchema,
  type ProposalSnapshot,
} from "@/lib/proposals/input";

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
const { revalidateTag } = await import("next/cache");
const { getProposal, listProposals, applyProposal, rejectProposal } =
  await import("./proposals");
const { submitProposalService, listProposalsService } =
  await import("@/lib/proposals/service");
const { getSession } = await import("@/lib/auth/session");
const { getEditablePost } = await import("@/lib/posts/admin");
const { updatePost } = await import("./crud");
const { discardPostChanges, publishPostChanges } = await import("./draft");
const { transitionPostStatus } = await import("./lifecycle");
const { transferPostsOwnership, promoteStagedDraft, discardStagedDraft } =
  await import("@/lib/posts/data");
const statusModule = await import("@/lib/posts/status");
let ids: StaffFixtureIds;
const { authorSession, adminSession, readerSession, noSession } =
  sessionSetters(sessionMock, () => ids);
const { runId } = registerPostSuiteLifecycle({
  testDb,
  pool,
  prefix: "t-air3-",
  onSeeded: (value) => {
    ids = value;
  },
});
const loadDraft = draftRowLoader(testDb);
const principal = { id: "test-codex", label: "Codex fixture" };
const notes = {
  summary: "Keep the author's voice.",
  editorial: ["Optional: shorten the introduction."],
  facts: [
    {
      claim: "A franchise record",
      finding: "Original source unavailable",
      status: "unresolved" as const,
      sources: [],
      action: "Verify before publishing.",
    },
  ],
  media: [
    {
      suggestion: "Optional banner",
      sourceUrl: null,
      mediaUrl: null,
      credit: "Unknown",
      altText: "Football stadium",
      permission: "Unverified",
    },
  ],
};
const skill = { name: "paulitakes-editor" as const, hash: "a".repeat(64) };
const conflict = { ok: false, code: "conflict" };
async function seed(suffix: string, published = false) {
  authorSession();
  const created = await seedPost(testDb, {
    runId,
    suffix,
    authorId: ids.authorId,
    categoryId: ids.categoryId,
    bodyMd: "First.\n\nKeep this.\n\nLast.\n",
    thumbnailUrl: "https://example.com/thumb.png",
    status: published ? "published" : "draft",
    publishAt: published ? new Date(Date.now() - 60000) : null,
  });
  return postRow(created.id);
}
async function input(
  postId: string,
  patch: Partial<ProposalSnapshot> = { bodyMd: "AI candidate." },
) {
  const loaded = await getEditablePost(postId, {
    id: ids.adminId,
    role: "admin",
  });
  if (!loaded) throw new Error("Missing fixture post");
  return {
    postId,
    sourceVersion: loaded.editVersion,
    candidate: { ...proposalSnapshotSchema.strip().parse(loaded), ...patch },
    notes,
    skill,
  };
}
async function propose(postId: string, patch?: Partial<ProposalSnapshot>) {
  const result = await submitProposalService(
    principal,
    await input(postId, patch),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
async function proposalRow(id: string) {
  return (
    await testDb.select().from(editProposals).where(eq(editProposals.id, id))
  )[0]!;
}
async function postRow(id: string) {
  return (await testDb.select().from(posts).where(eq(posts.id, id)))[0]!;
}

describe("immutable review proposals and human decisions", () => {
  it.each([false, true])(
    "submission preserves content/version and stores complete source/notes (public=%s)",
    async (published) => {
      const post = await seed(`submit-${published}`, published);
      const before = await postRow(post.id);
      vi.mocked(revalidateTag).mockClear();
      const proposal = await propose(post.id);
      expect(await postRow(post.id)).toEqual(before);
      expect(await loadDraft(post.id)).toBeUndefined();
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(proposal.base.bodyMd).toBe(before.bodyMd);
      expect(proposal.candidate.bodyMd).toBe("AI candidate.");
      expect(proposal.notes).toEqual(notes);
      expect(proposal.skill).toEqual(skill);
      expect(proposal.agentId).toBe(principal.id);
      expect(proposal.sourceVersion).toBe(before.editVersion);
    },
  );
  it.each([false, true])(
    "partial apply is atomic and invalidates old browser saves (public=%s)",
    async (published) => {
      const post = await seed(`apply-${published}`, published);
      const proposal = await propose(post.id, {
        bodyMd: "Better first.\n\nKeep this.\n\nBetter last.\n",
        title: "Suggested title",
        tags: ["Football"],
      });
      vi.mocked(revalidateTag).mockClear();
      const result = await applyProposal({
        proposalId: proposal.id,
        selectedChangeIds: ["body:0", "field:tags"],
      });
      expect(result.ok).toBe(true);
      const current = await getEditablePost(post.id, {
        id: ids.authorId,
        role: "author",
      });
      expect(current?.bodyMd).toBe("Better first.\n\nKeep this.\n\nLast.\n");
      expect(current?.title).toBe(post.title);
      expect(current?.tags).toEqual(["Football"]);
      expect(current?.editVersion).not.toBe(proposal.sourceVersion);
      if (published) {
        expect((await postRow(post.id)).bodyMd).toBe(proposal.base.bodyMd);
        expect(revalidateTag).not.toHaveBeenCalled();
      } else
        expect(revalidateTag).toHaveBeenCalledWith("post-list", { expire: 0 });
      const closed = await proposalRow(proposal.id);
      expect(closed).toMatchObject({
        status: "applied",
        decidedBy: ids.authorId,
        acceptedChangeIds: ["body:0", "field:tags"],
        rejectedChangeIds: ["body:1", "field:title"],
      });
      expect(closed.base).toEqual(proposal.base);
      expect(closed.candidate).toEqual(proposal.candidate);
      expect(closed.diff).toEqual(proposal.diff);
      expect(closed.notes).toEqual(notes);
      expect(
        await updatePost(
          post.id,
          { bodyMd: "Old tab" },
          proposal.sourceVersion,
        ),
      ).toMatchObject(conflict);
      expect(
        await applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: ["body:0"],
        }),
      ).toMatchObject(conflict);
    },
  );
  it("uses an existing staged snapshot and can revert selected fields to live", async () => {
    const post = await seed("staged-base", true);
    await updatePost(
      post.id,
      { title: "Pending title" },
      await loadEditVersion(testDb, post.id),
    );
    const proposal = await propose(post.id, { title: post.title });
    expect(proposal.base.title).toBe("Pending title");
    const result = await applyProposal({
      proposalId: proposal.id,
      selectedChangeIds: ["field:title"],
    });
    expect(result.ok).toBe(true);
    expect(await loadDraft(post.id)).toBeUndefined();
    expect((await postRow(post.id)).title).toBe(post.title);
    expect(await loadEditVersion(testDb, post.id)).not.toBe(
      proposal.sourceVersion,
    );
  });
  it("enforces one open proposal across agents and retains superseded history", async () => {
    const post = await seed("one-open");
    const request = await input(post.id);
    const results = await Promise.all([
      submitProposalService(principal, request),
      submitProposalService({ id: "other-agent", label: "Other" }, request),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const first = results.find((result) => result.ok)!;
    if (!first.ok) throw new Error("Expected proposal");
    expect(
      await submitProposalService(principal, {
        ...request,
        supersedesProposalId: crypto.randomUUID(),
      }),
    ).toMatchObject(conflict);
    const replacement = await submitProposalService(principal, {
      ...request,
      supersedesProposalId: first.data.id,
    });
    expect(replacement.ok).toBe(true);
    expect((await proposalRow(first.data.id)).status).toBe("superseded");
    expect(
      await testDb
        .select()
        .from(editProposals)
        .where(eq(editProposals.postId, post.id)),
    ).toHaveLength(2);
    if (!replacement.ok) throw new Error("Expected replacement");
    await expect(
      testDb
        .insert(editProposals)
        .values({ ...replacement.data, id: crypto.randomUUID() }),
    ).rejects.toThrow();
    expect(await listProposals(post.id)).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({ id: first.data.id }),
      ]),
    });
  });
  it("rejects stale metadata and source tokens while keeping proposals readable", async () => {
    const post = await seed("stale");
    const request = await input(post.id);
    const proposal = await propose(post.id);
    await updatePost(
      post.id,
      { bannerUrl: "https://example.com/new.png" },
      proposal.sourceVersion,
    );
    expect(
      await applyProposal({
        proposalId: proposal.id,
        selectedChangeIds: ["body:0"],
      }),
    ).toMatchObject(conflict);
    expect(await submitProposalService(principal, request)).toMatchObject(
      conflict,
    );
    expect(await getProposal(proposal.id)).toMatchObject({
      ok: true,
      data: { stale: true },
    });
    expect((await proposalRow(proposal.id)).status).toBe("open");
    const before = await postRow(post.id);
    expect(await rejectProposal(proposal.id)).toMatchObject({ ok: true });
    expect(await postRow(post.id)).toEqual(before);
    expect((await proposalRow(proposal.id)).status).toBe("rejected");
  });
  it.each(["discard", "promote", "publish", "transfer"])(
    "%s invalidates a proposal; ownership is checked again",
    async (mutation) => {
      const post = await seed(
        `invalidate-${mutation}`,
        mutation === "discard" || mutation === "promote",
      );
      if (mutation === "discard" || mutation === "promote")
        await updatePost(
          post.id,
          { bodyMd: "Pending" },
          await loadEditVersion(testDb, post.id),
        );
      const proposal = await propose(post.id);
      if (mutation === "discard") await discardPostChanges(post.id);
      if (mutation === "promote") await publishPostChanges(post.id);
      if (mutation === "publish")
        await transitionPostStatus(post.id, "published");
      if (mutation === "transfer")
        await transferPostsOwnership(ids.authorId, ids.adminId);
      const result = await applyProposal({
        proposalId: proposal.id,
        selectedChangeIds: ["body:0"],
      });
      expect(result.ok).toBe(false);
      if (mutation === "transfer") {
        expect(await getProposal(proposal.id)).toMatchObject({ ok: false });
        adminSession();
        expect(
          await applyProposal({
            proposalId: proposal.id,
            selectedChangeIds: ["body:0"],
          }),
        ).toMatchObject(conflict);
      } else expect(result).toMatchObject(conflict);
    },
  );
  it("session and role gates precede validation; unrelated authors see no proposal", async () => {
    const post = await seed("auth-order");
    const proposal = await propose(post.id);
    for (const session of [noSession, readerSession]) {
      session();
      expect(await getProposal("invalid")).toEqual({
        ok: false,
        error: "Not authorized.",
      });
      expect(await applyProposal(null)).toEqual({
        ok: false,
        error: "Not authorized.",
      });
      expect(await rejectProposal(proposal.id)).toEqual({
        ok: false,
        error: "Not authorized.",
      });
      expect(await listProposals(post.id)).toEqual({
        ok: false,
        error: "Not authorized.",
      });
    }
    authorSession();
    await testDb
      .update(posts)
      .set({ authorId: ids.adminId })
      .where(eq(posts.id, post.id));
    expect(await getProposal(proposal.id)).toEqual({
      ok: false,
      error: "Proposal or post not found.",
    });
    expect(await rejectProposal(proposal.id)).toMatchObject({ ok: false });
    expect(await listProposals(post.id)).toMatchObject({ ok: false });
    expect((await proposalRow(proposal.id)).status).toBe("open");
  });
  it("rejects forbidden payloads, selections and later slug collisions without closing", async () => {
    const post = await seed("invalid");
    const request = await input(post.id);
    for (const forbidden of [
      { authorId: ids.adminId },
      { status: "published" },
      { bodyMd: "x".repeat(100001) },
    ]) {
      expect(
        await submitProposalService(principal, {
          ...request,
          candidate: { ...request.candidate, ...forbidden },
        }),
      ).toMatchObject({ ok: false });
    }
    const targetSlug = `${runId}-collision`;
    const proposal = await propose(post.id, { slug: targetSlug });
    for (const selectedChangeIds of [
      [],
      ["field:authorId"],
      ["field:slug", "field:slug"],
    ])
      expect(
        await applyProposal({ proposalId: proposal.id, selectedChangeIds }),
      ).toMatchObject({ ok: false });
    const other = await seed("collision-holder");
    await testDb
      .update(posts)
      .set({ slug: targetSlug })
      .where(eq(posts.id, other.id));
    expect(
      await applyProposal({
        proposalId: proposal.id,
        selectedChangeIds: ["field:slug"],
      }),
    ).toEqual({ ok: false, error: "That slug is taken." });
    expect((await proposalRow(proposal.id)).status).toBe("open");
    expect((await postRow(post.id)).slug).toBe(post.slug);
  });
  it.each([false, true])(
    "concurrent apply/autosave has exactly one winner (public=%s)",
    async (published) => {
      const post = await seed(`race-${published}`, published);
      const proposal = await propose(post.id);
      const results = await Promise.all([
        applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: ["body:0"],
        }),
        updatePost(post.id, { bodyMd: "Human save." }, proposal.sourceVersion),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const current = await getEditablePost(post.id, {
        id: ids.authorId,
        role: "author",
      });
      expect(current?.bodyMd).toBe(
        results[0].ok ? "AI candidate." : "Human save.",
      );
      if (published)
        expect((await postRow(post.id)).bodyMd).toBe(proposal.base.bodyMd);
    },
  );
  it("rejects wall-clock visibility changes even when no cron changed the token", async () => {
    const post = await seed("time-crossing");
    const publishAt = new Date("2030-01-01T00:00:00Z");
    await testDb
      .update(posts)
      .set({ status: "scheduled", publishAt })
      .where(eq(posts.id, post.id));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2029-12-31T23:59:59Z"));
      const proposal = await propose(post.id);
      vi.setSystemTime(new Date("2030-01-01T00:00:01Z"));
      expect(
        await applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: ["body:0"],
        }),
      ).toMatchObject(conflict);
      expect((await postRow(post.id)).bodyMd).toBe(proposal.base.bodyMd);
    } finally {
      vi.useRealTimers();
    }
  });
  it("consumes an obsolete staged buffer when applying after timed archive", async () => {
    const post = await seed("elapsed-archive", true);
    const archiveAt = new Date(Date.now() + 60000);
    await testDb.update(posts).set({ archiveAt }).where(eq(posts.id, post.id));
    await updatePost(
      post.id,
      { title: "Pending title" },
      await loadEditVersion(testDb, post.id),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(archiveAt.getTime() + 1000));
      const proposal = await propose(post.id);
      expect(proposal.base.title).toBe("Pending title");
      expect(proposal.sourceIsPublic).toBe(false);
      expect(
        await applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: ["body:0"],
        }),
      ).toMatchObject({ ok: true });
      expect(await loadDraft(post.id)).toBeUndefined();
      expect(
        await getEditablePost(post.id, { id: ids.authorId, role: "author" }),
      ).toMatchObject({
        title: "Pending title",
        bodyMd: "AI candidate.",
        hasPendingChanges: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("rechecks the original visibility at write time, not a later destination", async () => {
    const post = await seed("mid-apply-time");
    const proposal = await propose(post.id);
    let reads = 0;
    const visibility = vi
      .spyOn(statusModule, "isPubliclyVisible")
      .mockImplementation(() => reads++ > 0);
    try {
      expect(
        await applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: ["body:0"],
        }),
      ).toMatchObject(conflict);
      expect((await postRow(post.id)).bodyMd).toBe(proposal.base.bodyMd);
      expect((await proposalRow(proposal.id)).status).toBe("open");
    } finally {
      visibility.mockRestore();
    }
  });
  it("old in-flight publish/discard cannot consume an apply in the same millisecond", async () => {
    const post = await seed("same-millisecond", true);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date());
      await updatePost(
        post.id,
        { title: "Pending title" },
        await loadEditVersion(testDb, post.id),
      );
      const proposal = await propose(post.id);
      const before = await loadDraft(post.id);
      expect(
        await applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: ["body:0"],
        }),
      ).toMatchObject({ ok: true });
      expect((await loadDraft(post.id))?.updatedAt).toEqual(before?.updatedAt);
      expect(
        await promoteStagedDraft(
          post.id,
          proposal.sourceVersion,
          proposal.base,
        ),
      ).toBe("conflict");
      expect(await discardStagedDraft(post.id, proposal.sourceVersion)).toBe(
        false,
      );
      expect((await loadDraft(post.id))?.bodyMd).toBe("AI candidate.");
      expect((await postRow(post.id)).bodyMd).toBe(post.bodyMd);
    } finally {
      vi.useRealTimers();
    }
  });
  it("validates the combined partial result, not just each full snapshot", async () => {
    const post = await seed("partial-size");
    await updatePost(
      post.id,
      { bodyMd: "a".repeat(40000) + "\nkeep\n" + "b".repeat(40000) },
      await loadEditVersion(testDb, post.id),
    );
    const proposal = await propose(post.id, {
      bodyMd: "c".repeat(60000) + "\nkeep\n" + "d".repeat(20000),
    });
    expect(
      await applyProposal({
        proposalId: proposal.id,
        selectedChangeIds: ["body:0"],
      }),
    ).toMatchObject({ ok: false, error: "Invalid change selection." });
    expect((await proposalRow(proposal.id)).status).toBe("open");
    expect((await postRow(post.id)).bodyMd).toBe(proposal.base.bodyMd);
  });
  it("concurrent apply and reject close the proposal exactly once", async () => {
    const post = await seed("decision-race");
    const proposal = await propose(post.id);
    const results = await Promise.all([
      applyProposal({ proposalId: proposal.id, selectedChangeIds: ["body:0"] }),
      rejectProposal(proposal.id),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await proposalRow(proposal.id)).status).toBe(
      results[0].ok ? "applied" : "rejected",
    );
    expect((await postRow(post.id)).bodyMd).toBe(
      results[0].ok ? "AI candidate." : proposal.base.bodyMd,
    );
  });
  it("keeps future schedules, stages current public edits, and cascades deleted history", async () => {
    const post = await seed("scheduled");
    const publishAt = new Date(Date.now() + 86400000);
    await testDb
      .update(posts)
      .set({ status: "scheduled", publishAt })
      .where(eq(posts.id, post.id));
    const proposal = await propose(post.id);
    expect(
      await applyProposal({
        proposalId: proposal.id,
        selectedChangeIds: ["body:0"],
      }),
    ).toMatchObject({ ok: true });
    expect(await postRow(post.id)).toMatchObject({
      status: "scheduled",
      publishAt,
      bodyMd: "AI candidate.",
    });
    expect(await loadDraft(post.id)).toBeUndefined();
    await testDb.delete(posts).where(eq(posts.id, post.id));
    expect(
      await testDb
        .select()
        .from(editProposals)
        .where(eq(editProposals.postId, post.id)),
    ).toHaveLength(0);
  });
});

it("paginates retained review history without repeating tied timestamps", async () => {
  const post = await seed("history-pages");
  const proposal = await propose(post.id);
  await testDb.insert(editProposals).values(
    Array.from({ length: 50 }, () => ({
      ...proposal,
      id: crypto.randomUUID(),
      status: "rejected" as const,
      decidedAt: new Date(),
    })),
  );
  const session = (await getSession())!;
  const first = await listProposalsService(post.id, session);
  const second = await listProposalsService(post.id, session, 2);
  const third = await listProposalsService(post.id, session, 3);
  expect(first.ok && first.data.length).toBe(50);
  expect(second.ok && second.data.length).toBe(1);
  expect(third.ok && third.data.length).toBe(0);
  if (!first.ok || !second.ok) throw new Error("Missing history");
  expect(
    new Set([...first.data, ...second.data].map((row) => row.id)).size,
  ).toBe(51);
});
