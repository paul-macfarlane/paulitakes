import { describe, expect, it, vi } from "vitest";
import {
  AGENT_BODY_LIMIT,
  AGENT_BODY_TIMEOUT_MS,
  configuredTokenMatches,
  tokenDigest,
  digestMatches,
  parseAgentBearer,
  requestDigest,
} from "./contract";
import { readAgentJson } from "./body";

describe("isolated agent token and bounded bodies", () => {
  it("accepts strict bearer tokens and rejects missing, malformed or reused server configuration", () => {
    const token = "a".repeat(64);
    expect(parseAgentBearer(`bEaReR ${token}`)).toBe(token);
    expect(configuredTokenMatches(token, token, [])).toBe(true);
    for (const expected of [
      undefined,
      "",
      "short",
      "x".repeat(257),
      " ".repeat(64),
    ])
      expect(configuredTokenMatches(token, expected, [])).toBe(false);
    expect(configuredTokenMatches(token, token, [token])).toBe(false);
    expect(configuredTokenMatches("b".repeat(64), token, [])).toBe(false);
    expect(digestMatches(tokenDigest(token), "bad")).toBe(false);
    for (const header of [
      null,
      "",
      `Basic ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token}, Bearer ${token}`,
      `Bearer ${token} extra`,
      "Bearer human-session-token",
    ])
      expect(parseAgentBearer(header)).toBeNull();
  });
  it("canonicalizes only object-key ordering", () => {
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
