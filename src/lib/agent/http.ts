import "server-only";
import {
  AGENT_RESPONSE_LIMIT,
  AgentError,
  type AgentOperation,
} from "./contract";
import { AgentFailure } from "./errors";

export type Audit = {
  principalId?: string;
  postId?: string;
  proposalId?: string;
};
export type Output = { status: number; body: unknown };
export function jsonResponse(
  output: Output,
  requestId: string,
  extra?: Record<string, string>,
) {
  const json = JSON.stringify(output.body);
  if (Buffer.byteLength(json) > AGENT_RESPONSE_LIMIT)
    throw new AgentFailure(AgentError.Unavailable);
  return new Response(json, {
    status: output.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      ...extra,
    },
  });
}
export function auditRequest(
  requestId: string,
  operation: AgentOperation,
  status: number,
  audit: Audit,
) {
  console.info(
    JSON.stringify({
      event: "agent_api",
      at: new Date().toISOString(),
      requestId,
      operation,
      status,
      ...audit,
    }),
  );
}
export function errorResponse(
  error: unknown,
  requestId: string,
  headers?: Record<string, string>,
): Response {
  const failure =
    error instanceof AgentFailure
      ? error
      : new AgentFailure(AgentError.Unavailable);
  return jsonResponse(
    {
      status: failure.status,
      body: { error: failure.code, message: failure.message, requestId },
    },
    requestId,
    {
      ...(failure.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
      ...(failure.retryAfter
        ? { "Retry-After": String(failure.retryAfter) }
        : {}),
      ...headers,
    },
  );
}
