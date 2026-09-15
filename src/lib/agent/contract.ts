import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Stable attribution/receipt namespace; token rotation must not reset retries.
export const AGENT_PRINCIPAL = {
  id: "4ed8a71b-df62-4d7f-a84e-385bbca5ba76",
  label: "Configured editorial agent",
} as const;
export const AgentQuota = { Read: "read", Submit: "submit" } as const;
export type AgentQuota = (typeof AgentQuota)[keyof typeof AgentQuota];
export const AgentOperation = {
  List: "listDrafts",
  Read: "readDraft",
  Submit: "submitProposal",
  Unsupported: "unsupportedMethod",
} as const;
export type AgentOperation =
  (typeof AgentOperation)[keyof typeof AgentOperation];
export const AgentError = {
  Unauthorized: "unauthorized",
  Invalid: "invalid_request",
  Conflict: "conflict",
  Missing: "not_found",
  Gone: "gone",
  TooLarge: "too_large",
  MediaType: "unsupported_media_type",
  RateLimited: "rate_limited",
  Timeout: "request_timeout",
  Unavailable: "unavailable",
  Method: "method_not_allowed",
} as const;
export type AgentError = (typeof AgentError)[keyof typeof AgentError];
export const AGENT_BODY_LIMIT = 1024 * 1024;
export const AGENT_RESPONSE_LIMIT = 1024 * 1024;
export const AGENT_BODY_TIMEOUT_MS = 10000;
export const AGENT_WINDOW_MS = 60000;
export const AGENT_READ_LIMIT = 60;
export const AGENT_SUBMIT_LIMIT = 6;
export const agentListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    after: z.uuid().optional(),
  })
  .strict();
export const agentIdSchema = z.uuid();
export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function parseAgentBearer(header: string | null): string | null {
  return /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(header ?? "")?.[1] ?? null;
}
export function configuredTokenMatches(
  provided: string,
  expected: string | undefined,
  reserved: (string | undefined)[],
): boolean {
  if (
    !expected ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(expected) ||
    reserved.includes(expected)
  )
    return false;
  return digestMatches(tokenDigest(provided), tokenDigest(expected));
}
export function digestMatches(provided: string, stored: string): boolean {
  // Malformed persisted hashes fail closed without variable-size comparisons.
  if (!/^[a-f0-9]{64}$/.test(stored) || !/^[a-f0-9]{64}$/.test(provided))
    return false;
  return timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(stored, "hex"),
  );
}
export function requestDigest(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, nested]) => [key, canonical(nested)]),
      );
    return input;
  }
  return tokenDigest(JSON.stringify(canonical(value)));
}
