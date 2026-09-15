import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  agentApiState,
  agentReceipts,
  editProposals,
  posts,
  postDrafts,
} from "@/db/schema";
import {
  registerPostSuiteLifecycle,
  seedPost,
  type StaffFixtureIds,
} from "@/test/helpers";
import {
  AgentQuota,
  AGENT_READ_LIMIT,
  AGENT_SUBMIT_LIMIT,
  AGENT_PRINCIPAL,
} from "./contract";

// The dev database is shared. Keep fixtures away from the real API's stable
// principal so tests never reset its counters or erase its retry receipts.
vi.mock("./contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./contract")>();
  return {
    ...actual,
    AGENT_PRINCIPAL: { ...actual.AGENT_PRINCIPAL, id: crypto.randomUUID() },
  };
});
const config = vi.hoisted(() => ({
  AGENT_API_TOKEN: "",
  BETTER_AUTH_SECRET: "s".repeat(64),
  CRON_SECRET: "c".repeat(64),
}));
vi.mock("@/lib/shared/env", () => ({ env: config }));
const { pool, testDb } = await vi.hoisted(async () =>
  (await import("@/test/helpers")).createTestDb(),
);
vi.mock("@/db", () => ({ db: testDb }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
const { revalidateTag } = await import("next/cache");
const { GET: list, POST: forbiddenListWrite } =
  await import("@/app/api/agent/v1/drafts/route");
const { GET: read } = await import("@/app/api/agent/v1/drafts/[id]/route");
const { POST: submit, DELETE: forbiddenDelete } =
  await import("@/app/api/agent/v1/edit-proposals/route");
const agentData = await import("./data");
const { admitAgent, withAuthorizedAgent } = await import("./auth");
let ids: StaffFixtureIds;
const { runId } = registerPostSuiteLifecycle({
  testDb,
  pool,
  prefix: "t-air5-",
  onSeeded: (value) => {
    ids = value;
  },
});
const audit = vi.spyOn(console, "info").mockImplementation(() => {});
beforeEach(async () => {
  audit.mockClear();
  vi.mocked(revalidateTag).mockClear();
  await testDb
    .delete(agentReceipts)
    .where(eq(agentReceipts.principalId, AGENT_PRINCIPAL.id));
  await testDb
    .delete(agentApiState)
    .where(eq(agentApiState.id, AGENT_PRINCIPAL.id));
  await testDb.insert(agentApiState).values({ id: AGENT_PRINCIPAL.id });
  config.AGENT_API_TOKEN = "";
});
afterAll(async () => {
  await testDb
    .delete(agentReceipts)
    .where(eq(agentReceipts.principalId, AGENT_PRINCIPAL.id));
  await testDb
    .delete(agentApiState)
    .where(eq(agentApiState.id, AGENT_PRINCIPAL.id));
  audit.mockRestore();
});
async function configuredAgent() {
  const token = randomBytes(32).toString("base64url");
  config.AGENT_API_TOKEN = token;
  return { ...AGENT_PRINCIPAL, token };
}
async function source(
  suffix: string,
  published = false,
  authorId = ids.authorId,
) {
  return seedPost(testDb, {
    runId,
    suffix,
    authorId,
    categoryId: ids.categoryId,
    status: published ? "published" : "draft",
    publishAt: published ? new Date(Date.now() - 60000) : null,
    bodyMd: "Private saved fan voice.",
    thumbnailUrl: "https://example.com/thumb.png",
  });
}
function request(
  token?: string,
  path = "/drafts",
  body?: unknown,
  key = crypto.randomUUID(),
) {
  return new Request(`http://localhost/api/agent/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token
        ? { authorization: `Bearer ${token}` }
        : { cookie: "better-auth.session_token=human-session" }),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function getSource(token: string, id: string) {
  return read(request(token, `/drafts/${id}`), {
    params: Promise.resolve({ id }),
  });
}
async function payload(token: string, id: string) {
  const response = await getSource(token, id);
  expect(response.status).toBe(200);
  const data = await response.json();
  return {
    postId: id,
    sourceVersion: data.sourceVersion,
    candidate: { ...data.snapshot, bodyMd: "An improved fan take." },
    skill: { name: "paulitakes-editor", hash: "a".repeat(64) },
    notes: { summary: "Preserve voice.", editorial: [], facts: [], media: [] },
  };
}
async function loadPost(id: string) {
  return (await testDb.select().from(posts).where(eq(posts.id, id)))[0]!;
}
function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
}

describe("configured agent API", () => {
  it("denies cookies, unknown tokens, absent/malformed config and reused auth/job secrets", async () => {
    const item = await source("denials");
    const auth = await configuredAgent();
    const attempts = [
      await list(request()),
      await list(request("x".repeat(64))),
    ];
    for (const value of [
      "",
      "short",
      config.BETTER_AUTH_SECRET,
      config.CRON_SECRET,
    ]) {
      config.AGENT_API_TOKEN = value;
      attempts.push(await getSource(value || auth.token, item.id));
    }
    for (const response of attempts) {
      expect(response.status).toBe(401);
      assertPrivate(response);
      expect(await response.text()).not.toContain("Private saved fan voice.");
    }
  });
  it("initializes only quota state on first authenticated use without provisioning", async () => {
    await testDb
      .delete(agentApiState)
      .where(eq(agentApiState.id, AGENT_PRINCIPAL.id));
    expect((await list(request())).status).toBe(401);
    expect(
      await testDb
        .select()
        .from(agentApiState)
        .where(eq(agentApiState.id, AGENT_PRINCIPAL.id)),
    ).toHaveLength(0);
    const auth = await configuredAgent();
    const responses = await Promise.all([
      list(request(auth.token)),
      list(request(auth.token)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const [state] = await testDb
      .select()
      .from(agentApiState)
      .where(eq(agentApiState.id, AGENT_PRINCIPAL.id));
    expect(Object.keys(state!).sort()).toEqual(
      ["id", "readCount", "readWindow", "submitCount", "submitWindow"].sort(),
    );
    expect(state!.readCount).toBe(2);
  });
  it("returns only review fields across authors, prefers the staged snapshot and does not create one on read", async () => {
    const auth = await configuredAgent();
    const draft = await source("other-author", false, ids.adminId);
    const live = await source("public-read", true);
    const before = await loadPost(live.id);
    const loaded = await (await getSource(auth.token, live.id)).json();
    expect(Object.keys(loaded).sort()).toEqual(
      [
        "categories",
        "categoriesTruncated",
        "context",
        "id",
        "openProposalId",
        "snapshot",
        "sourceIsPublic",
        "sourceVersion",
      ].sort(),
    );
    expect(loaded.snapshot.bodyMd).toBe("Private saved fan voice.");
    expect(await loadPost(live.id)).toEqual(before);
    expect(
      await testDb
        .select()
        .from(postDrafts)
        .where(eq(postDrafts.postId, live.id)),
    ).toHaveLength(0);
    expect((await getSource(auth.token, draft.id)).status).toBe(200);
    await testDb.insert(postDrafts).values({
      postId: live.id,
      ...loaded.snapshot,
      title: "Private pending title",
      bodyMd: "Private pending body.",
      updatedAt: new Date(),
    });
    const pending = await (await getSource(auth.token, live.id)).json();
    expect(pending.snapshot).toMatchObject({
      title: "Private pending title",
      bodyMd: "Private pending body.",
    });
    expect(pending.sourceIsPublic).toBe(true);
    expect(Object.keys(pending.snapshot).sort()).toEqual(
      [
        "title",
        "slug",
        "bodyMd",
        "categoryId",
        "tags",
        "thumbnailUrl",
        "bannerUrl",
        "videoUrl",
      ].sort(),
    );
    expect(revalidateTag).not.toHaveBeenCalled();
  });
  it("bounds list pages and validates queries and IDs after auth", async () => {
    const auth = await configuredAgent();
    await source("page-a");
    await source("page-b");
    const firstResponse = await list(request(auth.token, "/drafts?limit=1"));
    assertPrivate(firstResponse);
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(1);
    expect(Object.keys(first.items[0]).sort()).toEqual(
      ["id", "title", "status", "sourceVersion"].sort(),
    );
    const next = await (
      await list(
        request(auth.token, `/drafts?limit=1&after=${first.nextCursor}`),
      )
    ).json();
    expect(next.items[0].id).not.toBe(first.items[0].id);
    for (const query of [
      "limit=51",
      "limit=0",
      "limit=1&limit=2",
      "authorId=someone",
      "after=bad",
    ])
      expect((await list(request(auth.token, `/drafts?${query}`))).status).toBe(
        400,
      );
    expect((await getSource(auth.token, "bad")).status).toBe(400);
    expect((await getSource(auth.token, crypto.randomUUID())).status).toBe(404);
    expect(
      (
        await read(request(undefined, "/drafts/bad"), {
          params: Promise.resolve({ id: "bad" }),
        })
      ).status,
    ).toBe(401);
  });
  it.each([false, true])(
    "creates one immutable proposal and retry receipt without modifying the source (public=%s)",
    async (published) => {
      const auth = await configuredAgent();
      const item = await source(`submit-${published}`, published);
      const body = await payload(auth.token, item.id);
      const before = await loadPost(item.id);
      const key = crypto.randomUUID();
      const first = await submit(
        request(auth.token, "/edit-proposals", body, key),
      );
      assertPrivate(first);
      expect(first.status).toBe(201);
      const created = await first.json();
      expect(Object.keys(created).sort()).toEqual(
        ["id", "postId", "replayed", "reviewPath"].sort(),
      );
      expect(created.reviewPath).toBe(
        `/admin/posts/${item.id}/reviews/${created.id}`,
      );
      const retry = await submit(
        request(
          auth.token,
          "/edit-proposals",
          Object.fromEntries(Object.entries(body).reverse()),
          key,
        ),
      );
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        id: created.id,
        replayed: true,
      });
      expect(await loadPost(item.id)).toEqual(before);
      expect(
        await testDb
          .select()
          .from(postDrafts)
          .where(eq(postDrafts.postId, item.id)),
      ).toHaveLength(0);
      const rows = await testDb
        .select()
        .from(editProposals)
        .where(eq(editProposals.postId, item.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        agentId: auth.id,
        agentLabel: AGENT_PRINCIPAL.label,
        status: "open",
        sourceIsPublic: published,
      });
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );
  it("rejects forbidden proposal fields, changed keys, stale versions and implicit replacement", async () => {
    const auth = await configuredAgent();
    const item = await source("conflicts");
    const body = await payload(auth.token, item.id);
    const key = crypto.randomUUID();
    expect(
      (
        await submit(
          request(auth.token, "/edit-proposals", {
            ...body,
            candidate: { ...body.candidate, status: "published" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await submit(
          request(auth.token, "/edit-proposals", {
            ...body,
            agentId: "forged",
          }),
        )
      ).status,
    ).toBe(400);
    const created = await (
      await submit(request(auth.token, "/edit-proposals", body, key))
    ).json();
    expect(
      (
        await submit(
          request(
            auth.token,
            "/edit-proposals",
            {
              ...body,
              candidate: { ...body.candidate, title: "Changed payload" },
            },
            key,
          ),
        )
      ).status,
    ).toBe(409);
    expect(
      (await submit(request(auth.token, "/edit-proposals", body))).status,
    ).toBe(409);
    const replacement = await submit(
      request(auth.token, "/edit-proposals", {
        ...body,
        supersedesProposalId: created.id,
      }),
    );
    expect(replacement.status).toBe(201);
    const stored = (
      await testDb
        .select()
        .from(editProposals)
        .where(eq(editProposals.id, created.id))
    )[0]!;
    expect(stored.status).toBe("superseded");
    // Advance the quota window; this case isolates the stale-source guard.
    await testDb
      .update(agentApiState)
      .set({ submitWindow: new Date(Date.now() - 61000) })
      .where(eq(agentApiState.id, auth.id));
    const other = await configuredAgent();
    await testDb
      .update(posts)
      .set({ title: "Human changed it", editVersion: crypto.randomUUID() })
      .where(eq(posts.id, item.id));
    expect(
      (
        await submit(
          request(other.token, "/edit-proposals", {
            ...body,
            supersedesProposalId: (await replacement.json()).id,
          }),
        )
      ).status,
    ).toBe(409);
  });
  it("serializes simultaneous retries and retains a tombstone after post deletion", async () => {
    const auth = await configuredAgent();
    const item = await source("retries");
    const body = await payload(auth.token, item.id);
    const key = crypto.randomUUID();
    const responses = await Promise.all([
      submit(request(auth.token, "/edit-proposals", body, key)),
      submit(request(auth.token, "/edit-proposals", body, key)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    await testDb.delete(posts).where(eq(posts.id, item.id));
    expect(
      (await submit(request(auth.token, "/edit-proposals", body, key))).status,
    ).toBe(410);
  });
  it("enforces durable independent quotas, counts invalid writes and emits retry-after", async () => {
    const auth = await configuredAgent();
    const now = new Date();
    await testDb
      .update(agentApiState)
      .set({
        readWindow: now,
        readCount: AGENT_READ_LIMIT - 1,
        submitWindow: now,
        submitCount: AGENT_SUBMIT_LIMIT - 1,
      })
      .where(eq(agentApiState.id, auth.id));
    const reads = await Promise.all([
      list(request(auth.token)),
      list(request(auth.token)),
    ]);
    expect(reads.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(
      (await submit(request(auth.token, "/edit-proposals", {}))).status,
    ).toBe(400);
    const rotated = await configuredAgent();
    const limited = await submit(request(rotated.token, "/edit-proposals", {}));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    assertPrivate(limited);
    await testDb
      .update(agentApiState)
      .set({ readWindow: new Date(Date.now() - 61000) })
      .where(eq(agentApiState.id, auth.id));
    expect((await list(request(rotated.token))).status).toBe(200);
  });
  it("rejects the old token after configuration changes and rolls back receipt failures", async () => {
    const auth = await configuredAgent();
    const bearer = await admitAgent(`Bearer ${auth.token}`, AgentQuota.Read);
    config.AGENT_API_TOKEN = "";
    const work = vi.fn();
    await expect(withAuthorizedAgent(bearer, work)).rejects.toMatchObject({
      status: 401,
    });
    expect(work).not.toHaveBeenCalled();
    const writer = await configuredAgent();
    const item = await source("rollback");
    const body = await payload(writer.token, item.id);
    const spy = vi
      .spyOn(agentData, "insertReceipt")
      .mockRejectedValueOnce(new Error("SENSITIVE SQL TOKEN BODY"));
    const response = await submit(
      request(writer.token, "/edit-proposals", body),
    );
    spy.mockRestore();
    expect(response.status).toBe(503);
    expect(
      await testDb
        .select()
        .from(editProposals)
        .where(eq(editProposals.postId, item.id)),
    ).toHaveLength(0);
    expect(
      await testDb
        .select()
        .from(agentReceipts)
        .where(eq(agentReceipts.principalId, writer.id)),
    ).toHaveLength(0);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("SENSITIVE");
  });
  it("logs only fixed metadata, rejects unsupported methods, and sanitizes failures", async () => {
    const auth = await configuredAgent();
    const response = await list(
      new Request(
        "http://localhost/api/agent/v1/drafts?secret=private-marker",
        {
          headers: {
            authorization: `Bearer ${auth.token}`,
            "x-request-id": "caller-marker",
          },
        },
      ),
    );
    expect(response.status).toBe(400);
    const events = audit.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events[0]).toMatchObject({
      event: "agent_api",
      operation: "listDrafts",
      status: 400,
      principalId: auth.id,
    });
    for (const key of Object.keys(events[0]))
      expect([
        "event",
        "at",
        "requestId",
        "operation",
        "status",
        "principalId",
        "postId",
        "proposalId",
      ]).toContain(key);
    expect(JSON.stringify(events)).not.toContain(auth.token);
    expect(JSON.stringify(events)).not.toContain("private-marker");
    expect(JSON.stringify(events)).not.toContain("caller-marker");
    for (const denied of [forbiddenDelete(), forbiddenListWrite()]) {
      expect(denied.status).toBe(405);
      assertPrivate(denied);
    }
    const spy = vi
      .spyOn(agentData, "lockAgentState")
      .mockRejectedValueOnce(new Error("SECRET DATABASE ERROR"));
    const unavailable = await list(request(auth.token));
    spy.mockRestore();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("SECRET");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("SECRET");
  });
});

it("rolls back a supersession if receipt persistence fails", async () => {
  const auth = await configuredAgent();
  const item = await source("receipt-rollback");
  const body = await payload(auth.token, item.id);
  const original = await (
    await submit(request(auth.token, "/edit-proposals", body))
  ).json();
  const realInsert = agentData.insertReceipt;
  const spy = vi
    .spyOn(agentData, "insertReceipt")
    .mockImplementationOnce(async (...args) => {
      await realInsert(...args);
      throw new Error("Synthetic receipt failure");
    });
  try {
    const response = await submit(
      request(auth.token, "/edit-proposals", {
        ...body,
        supersedesProposalId: original.id,
      }),
    );
    expect(response.status).toBe(503);
  } finally {
    spy.mockRestore();
  }
  const proposals = await testDb
    .select()
    .from(editProposals)
    .where(eq(editProposals.postId, item.id));
  expect(proposals).toHaveLength(1);
  expect(proposals[0]).toMatchObject({ id: original.id, status: "open" });
  expect(
    await testDb
      .select()
      .from(agentReceipts)
      .where(eq(agentReceipts.principalId, auth.id)),
  ).toHaveLength(1);
});

it("preserves receipts across token rotation, human edits and closure, and bounds large stored sources", async () => {
  const auth = await configuredAgent();
  const item = await source("closed-replay");
  const body = await payload(auth.token, item.id);
  const key = crypto.randomUUID();
  const created = await (
    await submit(request(auth.token, "/edit-proposals", body, key))
  ).json();
  await testDb
    .update(editProposals)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(eq(editProposals.id, created.id));
  await testDb
    .update(posts)
    .set({ bodyMd: "Changed by a human." })
    .where(eq(posts.id, item.id));
  const rotated = await configuredAgent();
  expect((await list(request(auth.token))).status).toBe(401);
  const replay = await submit(
    request(rotated.token, "/edit-proposals", body, key),
  );
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ id: created.id, replayed: true });
  await testDb
    .update(posts)
    .set({ bodyMd: "x".repeat(1024 * 1024 + 1) })
    .where(eq(posts.id, item.id));
  const response = await getSource(rotated.token, item.id);
  expect(response.status).toBe(503);
  assertPrivate(response);
  expect((await response.text()).length).toBeLessThan(250);
});
