import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorServer, readConfig } from "./server";

const token = "synthetic-local-agent-token-for-unit-tests";
const brief =
  "---\nname: paulitakes-editor\ndescription: Test fixture\n---\nPreserve the author's voice.\n";
let dir: string;
let client: Client;
let server: ReturnType<typeof createEditorServer>;
const http = vi.fn<typeof fetch>();
const call = (name: string, args = {}) =>
  client.callTool({ name, arguments: args });
const proposal = () => ({
  postId: randomUUID(),
  sourceVersion: randomUUID(),
  idempotencyKey: randomUUID(),
  candidate: {
    title: "My take",
    slug: "my-take",
    bodyMd: "My take.",
    categoryId: 1,
    tags: [],
    thumbnailUrl: "",
    bannerUrl: null,
    videoUrl: null,
  },
  notes: { summary: "Preserve voice.", editorial: [], facts: [], media: [] },
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "editor-mcp-"));
  await writeFile(join(dir, "SKILL.md"), brief);
  server = createEditorServer(
    readConfig({
      PAULITAKES_URL: "https://example.com",
      AGENT_API_TOKEN: token,
      PAULITAKES_EDITOR_SKILL_PATH: join(dir, "SKILL.md"),
    }),
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  vi.stubGlobal("fetch", http);
  http.mockResolvedValue(Response.json({ ok: true }));
});
afterEach(async () => {
  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  http.mockReset();
});

describe("local editor MCP", () => {
  it("exposes only review tools and requires the actual brief before API access", async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "list_drafts",
      "load_editor_brief",
      "read_draft",
      "submit_proposal",
    ]);
    expect(await call("read_draft", { postId: randomUUID() })).toMatchObject({
      isError: true,
    });
    expect(await call("submit_proposal", proposal())).toMatchObject({
      isError: true,
    });
    expect(http).not.toHaveBeenCalled();
    const loaded = await call("load_editor_brief");
    expect(JSON.stringify(loaded)).toContain(
      createHash("sha256").update(brief).digest("hex"),
    );
    expect(JSON.stringify(loaded)).toContain("Preserve the author's voice.");
    expect(JSON.stringify(loaded)).toContain("https://example.com");
    await call("list_drafts", { limit: 3 });
    expect(http).toHaveBeenCalledWith(
      "https://example.com/api/agent/v1/drafts?limit=3",
      expect.objectContaining({
        redirect: "error",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  });
  it("attaches the loaded brief attribution and preserves retry inputs", async () => {
    await call("load_editor_brief");
    const input = proposal();
    await call("submit_proposal", input);
    await call("submit_proposal", input);
    expect(http).toHaveBeenCalledTimes(2);
    const options = http.mock.calls[0][1]!;
    expect(options.body).toBe(http.mock.calls[1][1]!.body);
    expect(options.headers).toMatchObject({
      "Idempotency-Key": input.idempotencyKey,
    });
    expect(JSON.parse(options.body as string)).toMatchObject({
      skill: {
        name: "paulitakes-editor",
        hash: createHash("sha256").update(brief).digest("hex"),
      },
    });
    expect(JSON.parse(options.body as string)).not.toHaveProperty(
      "idempotencyKey",
    );
  });
  it("rejects forged attribution, lifecycle fields and invalid notes before a request", async () => {
    await call("load_editor_brief");
    for (const extra of [
      { skill: { name: "paulitakes-editor", hash: "a".repeat(64) } },
      { publish: true },
      {
        notes: {
          summary: "x",
          editorial: [],
          media: [],
          facts: [
            {
              claim: "x",
              finding: "x",
              status: "verified",
              sources: [],
              action: "x",
            },
          ],
        },
      },
    ]) {
      expect(
        await call("submit_proposal", { ...proposal(), ...extra }),
      ).toMatchObject({ isError: true });
    }
    expect(http).not.toHaveBeenCalled();
  });
  it("fails closed if reloading the configured skill fails", async () => {
    await call("load_editor_brief");
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: wrong-skill\n---\nWrong brief.",
    );
    expect(await call("load_editor_brief")).toMatchObject({ isError: true });
    expect(await call("list_drafts")).toMatchObject({ isError: true });
    expect(http).not.toHaveBeenCalled();
    await rm(join(dir, "SKILL.md"));
    expect(await call("load_editor_brief")).toMatchObject({ isError: true });
  });
  it("does not expose HTTP response bodies or exception details on failures", async () => {
    await call("load_editor_brief");
    http.mockResolvedValueOnce(new Response(token, { status: 401 }));
    const rejected = await call("list_drafts");
    expect(rejected).toMatchObject({ isError: true });
    expect(JSON.stringify(rejected)).toContain("401");
    expect(JSON.stringify(rejected)).not.toContain(token);
    http.mockRejectedValueOnce(new Error(token));
    expect(JSON.stringify(await call("list_drafts"))).not.toContain(token);
  });
});

it.each([
  "http://example.com",
  "https://user:pass@example.com",
  "https://example.com/path",
  "https://example.com?x=1",
  "https://example.com#fragment",
  "file:///tmp/test",
])("rejects unsafe origins: %s", (origin) => {
  expect(() =>
    readConfig({
      PAULITAKES_URL: origin,
      AGENT_API_TOKEN: token,
      PAULITAKES_EDITOR_SKILL_PATH: "/tmp/SKILL.md",
    }),
  ).toThrow();
});
it("requires a valid token and an explicit absolute skill path", () => {
  const env = {
    PAULITAKES_URL: "http://127.0.0.1:3000",
    AGENT_API_TOKEN: token,
    PAULITAKES_EDITOR_SKILL_PATH: "/tmp/SKILL.md",
  };
  expect(readConfig(env).origin).toBe(env.PAULITAKES_URL);
  expect(() => readConfig({ ...env, AGENT_API_TOKEN: "" })).toThrow();
  expect(() =>
    readConfig({ ...env, PAULITAKES_EDITOR_SKILL_PATH: "SKILL.md" }),
  ).toThrow();
});
