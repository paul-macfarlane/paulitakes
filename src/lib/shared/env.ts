import "server-only";

import { z } from "zod";

// Validated once at first import (engineering.md: validate env at startup).
// Server-only: never import from client components.
//
// CRON_SECRET / ANALYTICS_SALT_SEED / AI gateway vars become required when
// their features land (cron revalidation, analytics, moderation).
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  // Unset/malformed configuration disables the isolated agent API.
  AGENT_API_TOKEN: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),

  // Local only — deployed envs authenticate to the AI Gateway via Vercel OIDC.
  AI_GATEWAY_API_KEY: z.string().optional(),

  CRON_SECRET: z.string().min(16).optional(),
  ANALYTICS_SALT_SEED: z.string().min(16).optional(),

  COMMENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(3),
  COMMENT_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),

  // Auto-ban repeat moderation offenders (CMT-10, ADR-0022): >= threshold
  // rejected comments within the trailing window bans the author.
  COMMENT_AUTOBAN_REJECTED_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  COMMENT_AUTOBAN_WINDOW_DAYS: z.coerce.number().int().positive().default(7),

  // Lets lower environments turn the LLM gate off while testing (owner
  // request 2026-07-12).
  COMMENT_MODERATION_ENABLED: z.stringbool().default(true),
  COMMENT_MODERATION_MODEL: z
    .string()
    .min(1)
    .default("anthropic/claude-haiku-4.5"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    z.flattenError(parsed.error).fieldErrors,
  );
  throw new Error("Invalid environment variables — see errors above");
}

export const env = parsed.data;
