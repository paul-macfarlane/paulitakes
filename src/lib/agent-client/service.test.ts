import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEditorCommand, readConfig } from "./service";

const token = "synthetic-local-agent-token-for-unit-tests";
const brief =
  "---\nname: paulitakes-editor\ndescription: Test fixture\n---\nPreserve the author's voice.\n";
const skillHash = createHash("sha256").update(brief).digest("hex");
let dir: string;
let config: ReturnType<typeof readConfig>;
const http = vi.fn<typeof fetch>();
const call = (name: string, input = {}) =>
  runEditorCommand(name, input, config);
const proposal = () => ({
  postId: randomUUID(),
  sourceVersion: randomUUID(),
  idempotencyKey: randomUUID(),
  skillHash,
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
  notes: {
    summary: "Preserve voice.",
    editorial: [],
    facts: [],
    media: [],
    changes: [],
  },
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "editor-client-"));
  await writeFile(join(dir, "SKILL.md"), brief);
  config = readConfig({
    PAULITAKES_URL: "https://example.com",
    AGENT_API_TOKEN: token,
    PAULITAKES_EDITOR_SKILL_PATH: join(dir, "SKILL.md"),
  });
  vi.stubGlobal("fetch", http);
  http.mockImplementation(async () => Response.json({ ok: true }));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  http.mockReset();
});

describe("local review client", () => {
  it("compares saved snapshots locally and returns exact explanation targets", async () => {
    const base = proposal().candidate;
    const result = await call("compare", {
      base,
      candidate: { ...base, title: "Sharper title" },
    });
    expect(result).toEqual({
      wholeBodyReplacement: false,
      changes: [
        {
          changeId: "field:title",
          before: JSON.stringify(base.title),
          after: JSON.stringify("Sharper title"),
          explanation: "",
          sources: [],
        },
      ],
    });
    expect(http).not.toHaveBeenCalled();
  });
  it("loads the complete installed brief, exact attribution and a new retry key", async () => {
    const loaded = await call("brief");
    expect(loaded).toEqual({
      siteUrl: "https://example.com",
      brief,
      skill: { name: "paulitakes-editor", hash: skillHash },
      idempotencyKey: expect.any(String),
    });
    expect(await call("brief")).not.toEqual(loaded);
    expect(http).not.toHaveBeenCalled();
  });
  it("uses fixed read endpoints and bearer headers without following redirects", async () => {
    const after = randomUUID();
    await call("list", { limit: 3, after });
    expect(http).toHaveBeenLastCalledWith(
      `https://example.com/api/agent/v1/drafts?limit=3&after=${after}`,
      expect.objectContaining({
        redirect: "error",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    await call("read", { postId: after });
    expect(http).toHaveBeenLastCalledWith(
      `https://example.com/api/agent/v1/drafts/${after}`,
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("attaches verified brief attribution and preserves retry inputs across invocations", async () => {
    const input = proposal();
    await expect(call("submit", input)).resolves.toEqual({ ok: true });
    await expect(call("submit", input)).resolves.toEqual({ ok: true });
    expect(http).toHaveBeenCalledTimes(2);
    const options = http.mock.calls[0][1]!;
    expect(options.body).toBe(http.mock.calls[1][1]!.body);
    expect(options.headers).toMatchObject({
      "Idempotency-Key": input.idempotencyKey,
    });
    expect(JSON.parse(options.body as string)).toMatchObject({
      skill: { name: "paulitakes-editor", hash: skillHash },
    });
    expect(JSON.parse(options.body as string)).not.toHaveProperty("skillHash");
    expect(JSON.parse(options.body as string)).not.toHaveProperty(
      "idempotencyKey",
    );
  });
  it("rejects forbidden fields, invalid notes and unrecognized commands before a request", async () => {
    for (const extra of [
      { skill: { name: "paulitakes-editor", hash: skillHash } },
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
    ])
      await expect(call("submit", { ...proposal(), ...extra })).rejects.toThrow(
        "Invalid command input",
      );
    await expect(call("publish")).rejects.toThrow("Invalid command input");
    await expect(call("read", { postId: "../../users" })).rejects.toThrow(
      "Invalid command input",
    );
    await expect(
      call("submit", {
        ...proposal(),
        notes: { summary: "Legacy", editorial: [], facts: [], media: [] },
      }),
    ).rejects.toThrow("Invalid command input");
    expect(http).not.toHaveBeenCalled();
  });
  it("refuses submission when the loaded hash is missing, wrong, or the installed brief changed", async () => {
    await expect(
      call("submit", { ...proposal(), skillHash: undefined }),
    ).rejects.toThrow("Invalid command input");
    await expect(
      call("submit", { ...proposal(), skillHash: "a".repeat(64) }),
    ).rejects.toThrow("brief changed");
    await writeFile(config.skillPath, brief + "New instruction.\n");
    await expect(call("submit", proposal())).rejects.toThrow("brief changed");
    expect(http).not.toHaveBeenCalled();
  });
  it("reports missing or wrong skills without exposing file contents or paths", async () => {
    await writeFile(config.skillPath, token);
    await expect(call("brief")).rejects.toThrow(
      "not the Paulitakes Editor skill",
    );
    await expect(call("submit", proposal())).rejects.toThrow(
      "not the Paulitakes Editor skill",
    );
    await rm(config.skillPath);
    await expect(call("brief")).rejects.toThrow("Cannot read the editor skill");
    expect(http).not.toHaveBeenCalled();
  });
  it("sanitizes HTTP response bodies, network errors and malformed JSON", async () => {
    http.mockResolvedValueOnce(new Response(token, { status: 401 }));
    await expect(call("list")).rejects.toThrow("HTTP 401");
    http.mockRejectedValueOnce(new Error(token));
    await expect(call("list")).rejects.toThrow("could not be reached");
    http.mockResolvedValueOnce(new Response(token));
    await expect(call("list")).rejects.toThrow("returned invalid JSON");
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
