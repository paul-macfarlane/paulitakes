import { AgentError } from "./contract";

const ERRORS: Record<AgentError, { status: number; message: string }> = {
  unauthorized: {
    status: 401,
    message: "Invalid or unconfigured agent token.",
  },
  invalid_request: { status: 400, message: "Invalid request." },
  conflict: {
    status: 409,
    message:
      "The source, open proposal, or idempotency key conflicts. Read the current saved source before retrying.",
  },
  not_found: { status: 404, message: "Review source not found." },
  gone: { status: 410, message: "The proposal from this request was deleted." },
  rate_limited: {
    status: 429,
    message: "Agent request limit reached. Retry later.",
  },
  unavailable: {
    status: 503,
    message: "Agent service temporarily unavailable.",
  },
  method_not_allowed: { status: 405, message: "Method not allowed." },
};
export class AgentFailure extends Error {
  readonly status: number;
  constructor(
    readonly code: AgentError,
    readonly retryAfter?: number,
  ) {
    super(ERRORS[code].message);
    this.status = ERRORS[code].status;
  }
}
