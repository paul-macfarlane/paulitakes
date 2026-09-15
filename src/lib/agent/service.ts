import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "@/lib/posts/data";
import {
  findOpenProposal,
  loadSnapshots,
  withLockedSource,
} from "@/lib/proposals/data";
import { submitProposalService } from "@/lib/proposals/service";
import { submitProposalSchema } from "@/lib/proposals/input";
import { isPubliclyVisible } from "@/lib/posts/status";
import { ActionErrorCode } from "@/lib/shared/action-result";
import { admitAgent, withAuthorizedAgent } from "./auth";
import {
  findReceipt,
  insertReceipt,
  listSources,
  reviewCategories,
} from "./data";
import {
  AGENT_RESPONSE_LIMIT,
  AgentError,
  AgentOperation,
  AgentQuota,
  AGENT_PRINCIPAL,
  agentIdSchema,
  agentListSchema,
  requestDigest,
} from "./contract";
import { AgentFailure } from "./errors";

type Audit = { principalId?: string; postId?: string; proposalId?: string };
type Output = { status: number; body: unknown };
function queryParameters(request: Request) {
  const params = new URL(request.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length)
    throw new AgentFailure(AgentError.Invalid);
  return Object.fromEntries(params);
}
function response(
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
function auditRequest(
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
async function readSource(tx: Tx, id: string, audit: Audit): Promise<Output> {
  const source = await withLockedSource(
    id,
    async (lockedTx, post) => {
      audit.postId = id;
      const { effective: snapshot } = await loadSnapshots(lockedTx, id, post);
      const choices = await reviewCategories(lockedTx, snapshot.categoryId);
      const open = await findOpenProposal(lockedTx, id);
      return {
        id,
        sourceVersion: post.editVersion,
        snapshot,
        sourceIsPublic: isPubliclyVisible(post),
        context: {
          status: post.status,
          publishAt: post.publishAt,
          archiveAt: post.archiveAt,
        },
        openProposalId: open?.id ?? null,
        categories: choices.slice(0, 100),
        categoriesTruncated: choices.length > 100,
      };
    },
    tx,
  );
  if (!source) throw new AgentFailure(AgentError.Missing);
  return { status: 200, body: source };
}
async function submit(
  tx: Tx,
  input: unknown,
  key: string,
  audit: Audit,
): Promise<Output> {
  const parsed = submitProposalSchema.safeParse(input);
  if (!parsed.success) throw new AgentFailure(AgentError.Invalid);
  const hash = requestDigest(parsed.data);
  const receipt = await findReceipt(tx, AGENT_PRINCIPAL.id, key);
  if (receipt) {
    if (receipt.requestHash !== hash)
      throw new AgentFailure(AgentError.Conflict);
    if (!receipt.proposalId) throw new AgentFailure(AgentError.Gone);
    audit.postId = receipt.postId;
    audit.proposalId = receipt.proposalId;
    return {
      status: 200,
      body: {
        id: receipt.proposalId,
        postId: receipt.postId,
        reviewPath: `/admin/posts/${receipt.postId}/reviews/${receipt.proposalId}`,
        replayed: true,
      },
    };
  }
  const created = await submitProposalService(
    { id: AGENT_PRINCIPAL.id, label: AGENT_PRINCIPAL.label },
    parsed.data,
    tx,
  );
  if (!created.ok) {
    if (created.code === ActionErrorCode.Conflict)
      throw new AgentFailure(AgentError.Conflict);
    if (created.error === "Proposal or post not found.")
      throw new AgentFailure(AgentError.Missing);
    throw new AgentFailure(AgentError.Invalid);
  }
  audit.postId = created.data.postId;
  audit.proposalId = created.data.id;
  await insertReceipt(tx, {
    principalId: AGENT_PRINCIPAL.id,
    key,
    requestHash: hash,
    postId: created.data.postId,
    proposalId: created.data.id,
  });
  return {
    status: 201,
    body: {
      id: created.data.id,
      postId: created.data.postId,
      reviewPath: `/admin/posts/${created.data.postId}/reviews/${created.data.id}`,
      replayed: false,
    },
  };
}
export async function handleAgentRequest(
  request: Request,
  operation: AgentOperation,
  params?: Promise<{ id: string }>,
): Promise<Response> {
  const requestId = randomUUID();
  const audit: Audit = {};
  let status = 503;
  try {
    const quota =
      operation === AgentOperation.Submit ? AgentQuota.Submit : AgentQuota.Read;
    const bearer = await admitAgent(
      request.headers.get("authorization"),
      quota,
    );
    audit.principalId = AGENT_PRINCIPAL.id;
    const query = queryParameters(request);
    let work: (tx: Tx) => Promise<Output>;
    if (operation === AgentOperation.List) {
      const parsed = agentListSchema.safeParse(query);
      if (!parsed.success) throw new AgentFailure(AgentError.Invalid);
      work = async (tx) => {
        const rows = await listSources(
          tx,
          parsed.data.limit,
          parsed.data.after,
        );
        const items = rows.slice(0, parsed.data.limit);
        return {
          status: 200,
          body: {
            items,
            nextCursor:
              rows.length > parsed.data.limit ? items.at(-1)!.id : null,
          },
        };
      };
    } else {
      if (Object.keys(query).length > 0)
        throw new AgentFailure(AgentError.Invalid);
      if (operation === AgentOperation.Read) {
        const id = agentIdSchema.safeParse((await params)?.id);
        if (!id.success) throw new AgentFailure(AgentError.Invalid);
        work = (tx) => readSource(tx, id.data, audit);
      } else if (operation === AgentOperation.Submit) {
        const key = agentIdSchema.safeParse(
          request.headers.get("idempotency-key"),
        );
        if (!key.success) throw new AgentFailure(AgentError.Invalid);
        const input: unknown = await request.json().catch(() => {
          throw new AgentFailure(AgentError.Invalid);
        });
        work = (tx) => submit(tx, input, key.data, audit);
      } else throw new AgentFailure(AgentError.Method);
    }
    // Build the bounded response before commit: serialization/size failures
    // cannot commit a proposal while returning a failed request.
    const result = await withAuthorizedAgent(bearer, async (tx) =>
      response(await work(tx), requestId),
    );
    status = result.status;
    return result;
  } catch (error) {
    const failure =
      error instanceof AgentFailure
        ? error
        : new AgentFailure(AgentError.Unavailable);
    status = failure.status;
    return response(
      {
        status,
        body: { error: failure.code, message: failure.message, requestId },
      },
      requestId,
      {
        ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        ...(failure.retryAfter
          ? { "Retry-After": String(failure.retryAfter) }
          : {}),
      },
    );
  } finally {
    auditRequest(requestId, operation, status, audit);
  }
}
export function unsupportedAgentMethod(allow: string): Response {
  const requestId = randomUUID();
  const failure = new AgentFailure(AgentError.Method);
  auditRequest(requestId, AgentOperation.Unsupported, failure.status, {});
  return response(
    {
      status: failure.status,
      body: { error: failure.code, message: failure.message, requestId },
    },
    requestId,
    { Allow: allow },
  );
}
