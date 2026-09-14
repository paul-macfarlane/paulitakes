// Shared server-action return shape (design §8, §9). No "server-only" here:
// it's a plain type, and importing it never pulls server-only code into a
// client bundle.
export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; code?: ActionErrorCode };

// Common error copy shared across domains (posts, users, preview) so every
// caller shows identical wording rather than each redeclaring its own
// string.
export const GENERIC_ERROR = "Something went wrong. Please try again.";

export const CONFLICT_ERROR =
  "This post was changed elsewhere. Reload and try again.";

export const NOT_AUTHORIZED_ERROR = "Not authorized.";

export const ActionErrorCode = { Conflict: "conflict" } as const;
export type ActionErrorCode =
  (typeof ActionErrorCode)[keyof typeof ActionErrorCode];

export const CONFLICT_RESULT = {
  ok: false,
  error: CONFLICT_ERROR,
  code: ActionErrorCode.Conflict,
} as const;
