import { describe, expect, it, vi } from "vitest";
import {
  AGENT_BODY_LIMIT,
  AGENT_BODY_TIMEOUT_MS,
  AgentScope,
  createAgentCredential,
  credentialIssueSchema,
  digestMatches,
  parseAgentBearer,
  requestDigest,
} from "./contract";
import { readAgentJson } from "./body";

describe("isolated agent credentials and bounded bodies", () => {
  it("generates distinct high-entropy tokens, keeps only hashes, and parses strict bearer credentials", () => {
    const credential = createAgentCredential();
    expect(credential.token).toMatch(
      /^pt_agent_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(credential.tokenHash).not.toContain(credential.token);
    expect(createAgentCredential().token).not.toBe(credential.token);
    expect(parseAgentBearer(`bEaReR ${credential.token}`)).toEqual({
      id: credential.id,
      tokenHash: credential.tokenHash,
    });
    expect(digestMatches(credential.tokenHash, credential.tokenHash)).toBe(
      true,
    );
    expect(digestMatches(credential.tokenHash, "bad")).toBe(false);
    expect(digestMatches(credential.tokenHash, "0".repeat(64))).toBe(false);
    for (const header of [
      null,
      "",
      `Basic ${credential.token}`,
      `Bearer  ${credential.token}`,
      `Bearer ${credential.token}, Bearer ${credential.token}`,
      `Bearer ${credential.token} extra`,
      "Bearer human-session-token",
      "Bearer pt_agent_not-a-uuid.secret",
    ])
      expect(parseAgentBearer(header)).toBeNull();
  });
  it("validates credential issuance and canonicalizes only object-key ordering", () => {
    expect(
      credentialIssueSchema.safeParse({
        label: "Codex",
        days: 90,
        scopes: [AgentScope.Read, AgentScope.Submit],
      }).success,
    ).toBe(true);
    for (const patch of [
      { days: 0 },
      { days: 366 },
      { scopes: [] },
      { scopes: ["publish"] },
      { scopes: [AgentScope.Read, AgentScope.Read] },
      { label: "new\nline" },
    ])
      expect(
        credentialIssueSchema.safeParse({
          label: "Codex",
          days: 90,
          scopes: [AgentScope.Read],
          ...patch,
        }).success,
      ).toBe(false);
    expect(requestDigest({ a: 1, b: { c: 2, d: 3 } })).toBe(
      requestDigest({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(requestDigest({ tags: ["a", "b"] })).not.toBe(
      requestDigest({ tags: ["b", "a"] }),
    );
  });
  it.each([
    ["application/json", undefined, '{"ok":true}', null],
    ["application/json; charset=utf-8", undefined, '{"ok":true}', null],
    ["text/plain", undefined, "{}", "unsupported_media_type"],
    ["application/json", "gzip", "{}", "unsupported_media_type"],
    ["application/json", undefined, "bad", "invalid_request"],
  ])(
    "handles content type, encoding and JSON (%s/%s)",
    async (type, encoding, body, code) => {
      const request = new Request(
        "http://localhost/api/agent/v1/edit-proposals",
        {
          method: "POST",
          headers: {
            "content-type": type,
            ...(encoding ? { "content-encoding": encoding } : {}),
          },
          body,
        },
      );
      if (code)
        await expect(readAgentJson(request)).rejects.toMatchObject({ code });
      else await expect(readAgentJson(request)).resolves.toEqual({ ok: true });
    },
  );
  it("bounds declared and actual bytes, including chunked and understated lengths", async () => {
    for (const declared of [undefined, "1", String(AGENT_BODY_LIMIT + 1)]) {
      const request = new Request(
        "http://localhost/api/agent/v1/edit-proposals",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(declared ? { "content-length": declared } : {}),
          },
          body: " ".repeat(AGENT_BODY_LIMIT + 1),
        },
      );
      await expect(readAgentJson(request)).rejects.toMatchObject({
        code: "too_large",
      });
    }
  });
  it("cancels a stalled body on deadline", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const request = new Request(
        "http://localhost/api/agent/v1/edit-proposals",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: new ReadableStream({ cancel }),
          duplex: "half",
        } as RequestInit,
      );
      const failure = expect(readAgentJson(request)).rejects.toMatchObject({
        code: "request_timeout",
      });
      await vi.advanceTimersByTimeAsync(AGENT_BODY_TIMEOUT_MS);
      await failure;
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
