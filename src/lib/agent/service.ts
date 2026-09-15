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
  AgentError,
  AgentOperation,
  AgentQuota,
  AGENT_PRINCIPAL,
  agentIdSchema,
  agentListSchema,
  requestDigest,
} from "./contract";
import { AgentFailure } from "./errors";
import {
  auditRequest,
  errorResponse,
  jsonResponse,
  type Audit,
  type Output,
} from "./http";

type OperationWork = (tx: Tx) => Promise<Output>;

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
    const work = await prepareOperation(request, operation, params, audit);

    // Read the request before the operation transaction; serialize the response
    // before committing so size/serialization failures roll back the write.
    const result = await withAuthorizedAgent(bearer, async (tx) =>
      jsonResponse(await work(tx), requestId),
    );
    status = result.status;
    return result;
  } catch (error) {
    const result = errorResponse(error, requestId);
    status = result.status;
    return result;
  } finally {
    auditRequest(requestId, operation, status, audit);
  }
}

export function unsupportedAgentMethod(allow: string): Response {
  const requestId = randomUUID();
  const result = errorResponse(new AgentFailure(AgentError.Method), requestId, {
    Allow: allow,
  });
  auditRequest(requestId, AgentOperation.Unsupported, result.status, {});
  return result;
}

async function prepareOperation(
  request: Request,
  operation: AgentOperation,
  params: Promise<{ id: string }> | undefined,
  audit: Audit,
): Promise<OperationWork> {
  const query = queryParameters(request);
  if (operation !== AgentOperation.List && Object.keys(query).length > 0)
    throw new AgentFailure(AgentError.Invalid);

  switch (operation) {
    case AgentOperation.List: {
      const parsed = agentListSchema.safeParse(query);
      if (!parsed.success) throw new AgentFailure(AgentError.Invalid);
      return (tx) => listDrafts(tx, parsed.data.limit, parsed.data.after);
    }
    case AgentOperation.Read: {
      const id = agentIdSchema.safeParse((await params)?.id);
      if (!id.success) throw new AgentFailure(AgentError.Invalid);
      return (tx) => readDraft(tx, id.data, audit);
    }
    case AgentOperation.Submit: {
      const key = agentIdSchema.safeParse(
        request.headers.get("idempotency-key"),
      );
      if (!key.success) throw new AgentFailure(AgentError.Invalid);
      const input: unknown = await request.json().catch(() => {
        throw new AgentFailure(AgentError.Invalid);
      });
      return (tx) => submitProposal(tx, input, key.data, audit);
    }
    default:
      throw new AgentFailure(AgentError.Method);
  }
}

function queryParameters(request: Request) {
  const params = new URL(request.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length)
    throw new AgentFailure(AgentError.Invalid);
  return Object.fromEntries(params);
}

async function listDrafts(
  tx: Tx,
  limit: number,
  after?: string,
): Promise<Output> {
  const rows = await listSources(tx, limit, after);
  const items = rows.slice(0, limit);
  return {
    status: 200,
    body: { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null },
  };
}

function proposalResult(
  proposal: { id: string; postId: string },
  replayed: boolean,
  audit: Audit,
): Output {
  audit.postId = proposal.postId;
  audit.proposalId = proposal.id;
  return {
    status: replayed ? 200 : 201,
    body: {
      id: proposal.id,
      postId: proposal.postId,
      reviewPath: `/admin/posts/${proposal.postId}/reviews/${proposal.id}`,
      replayed,
    },
  };
}

async function readDraft(tx: Tx, id: string, audit: Audit): Promise<Output> {
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

async function submitProposal(
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
    return proposalResult(
      { id: receipt.proposalId, postId: receipt.postId },
      true,
      audit,
    );
  }
  const created = await submitProposalService(AGENT_PRINCIPAL, parsed.data, tx);
  if (!created.ok) {
    if (created.code === ActionErrorCode.Conflict)
      throw new AgentFailure(AgentError.Conflict);
    if (created.error === "Proposal or post not found.")
      throw new AgentFailure(AgentError.Missing);
    throw new AgentFailure(AgentError.Invalid);
  }
  const result = proposalResult(created.data, false, audit);
  await insertReceipt(tx, {
    principalId: AGENT_PRINCIPAL.id,
    key,
    requestHash: hash,
    postId: created.data.postId,
    proposalId: created.data.id,
  });
  return result;
}
