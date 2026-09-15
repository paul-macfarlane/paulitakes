import { describe, expect, it } from "vitest";
import {
  configuredTokenMatches,
  tokenDigest,
  digestMatches,
  parseAgentBearer,
  requestDigest,
} from "./contract";

describe("isolated agent token and request digests", () => {
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
});
