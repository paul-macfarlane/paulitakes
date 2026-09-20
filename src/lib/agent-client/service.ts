import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { agentListSchema, parseAgentBearer } from "@/lib/agent/contract";
import {
  submitProposalSchema,
  proposalSnapshotSchema,
  skillAttributionSchema,
} from "@/lib/proposals/input";

import { createProposalDiff, explanationTarget } from "@/lib/proposals/diff";

// Only these fixed messages may reach stderr; raw fetch/schema errors can contain secrets.
export class EditorCommandError extends Error {}
export function readConfig(env: Record<string, string | undefined>) {
  const origin = z.url().safeParse(env.PAULITAKES_URL);
  if (!origin.success)
    throw new EditorCommandError("Set PAULITAKES_URL to the site's origin.");
  const url = new URL(origin.data);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !(url.protocol === "https:" || (local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new EditorCommandError(
      "PAULITAKES_URL must be an HTTPS origin (HTTP is allowed for localhost).",
    );
  const token = parseAgentBearer(`Bearer ${env.AGENT_API_TOKEN ?? ""}`);
  if (!token)
    throw new EditorCommandError(
      "Set a valid AGENT_API_TOKEN in the helper's environment.",
    );
  const skillPath = env.PAULITAKES_EDITOR_SKILL_PATH;
  if (!skillPath || !isAbsolute(skillPath))
    throw new EditorCommandError(
      "Set PAULITAKES_EDITOR_SKILL_PATH to the installed editor SKILL.md's absolute path.",
    );
  return { origin: url.origin, token, skillPath };
}

export const EditorCommand = {
  Brief: "brief",
  Compare: "compare",
  List: "list",
  Read: "read",
  Submit: "submit",
} as const;
export const editorCommandSchema = z.enum(EditorCommand);
const submissionSchema = submitProposalSchema.omit({ skill: true }).extend({
  notes: submitProposalSchema.shape.notes.extend({
    changes: submitProposalSchema.shape.notes.shape.changes.unwrap(),
  }),
  idempotencyKey: z.uuid(),
  skillHash: skillAttributionSchema.shape.hash,
});

async function loadBrief(skillPath: string) {
  let bytes: Buffer;
  try {
    bytes = await readFile(skillPath);
  } catch {
    throw new EditorCommandError(
      "Cannot read the editor skill. Check PAULITAKES_EDITOR_SKILL_PATH.",
    );
  }
  const brief = bytes.toString("utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(brief)?.[1];
  if (!frontmatter || !/^name: paulitakes-editor\r?$/m.test(frontmatter))
    throw new EditorCommandError(
      "The configured file is not the Paulitakes Editor skill.",
    );
  return {
    brief,
    skill: {
      name: "paulitakes-editor" as const,
      hash: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new EditorCommandError(
      "Invalid command input. Follow docs/runbooks/agent-client.md and the shared proposal schema.",
    );
  return parsed.data;
}

export async function runEditorCommand(
  command: unknown,
  input: unknown,
  config: ReturnType<typeof readConfig>,
): Promise<unknown> {
  async function request(path: string, body?: unknown, key?: string) {
    try {
      const response = await fetch(`${config.origin}/api/agent/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          ...(body
            ? { "Content-Type": "application/json", "Idempotency-Key": key! }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new EditorCommandError(
          `Agent API returned HTTP ${response.status}. For 409, re-read the draft; never silently supersede. For 429, wait a minute. Retry uncertain submissions with the same saved input.`,
        );
      return await response.json();
    } catch (error) {
      if (error instanceof EditorCommandError) throw error;
      throw new EditorCommandError(
        "Agent API could not be reached or returned invalid JSON. Check configuration. Retry uncertain submissions with the same saved input.",
      );
    }
  }

  switch (validate(editorCommandSchema, command)) {
    case EditorCommand.Brief:
      validate(z.object({}).strict(), input);
      return {
        siteUrl: config.origin,
        ...(await loadBrief(config.skillPath)),
        idempotencyKey: randomUUID(),
      };
    case EditorCommand.Compare: {
      const { base, candidate } = validate(
        z
          .object({
            base: proposalSnapshotSchema,
            candidate: proposalSnapshotSchema,
          })
          .strict(),
        input,
      );
      const diff = createProposalDiff(base, candidate);
      return {
        wholeBodyReplacement: diff.wholeBodyReplacement,
        changes: diff.changes.map((change) => ({
          ...explanationTarget(change),
          explanation: "",
          sources: [],
        })),
      };
    }
    case EditorCommand.List: {
      const { limit, after } = validate(agentListSchema, input);
      const query = new URLSearchParams({ limit: String(limit) });
      if (after) query.set("after", after);
      return request(`drafts?${query}`);
    }
    case EditorCommand.Read: {
      const { postId } = validate(
        z.object({ postId: z.uuid() }).strict(),
        input,
      );
      return request(`drafts/${postId}`);
    }
    case EditorCommand.Submit: {
      const { idempotencyKey, skillHash, ...proposal } = validate(
        submissionSchema,
        input,
      );
      const { skill } = await loadBrief(config.skillPath);
      if (skill.hash !== skillHash)
        throw new EditorCommandError(
          "The editor brief changed. Load it again and reassess the review before submitting; do not change an uncertain retry's saved input.",
        );
      return request("edit-proposals", { ...proposal, skill }, idempotencyKey);
    }
  }
}
