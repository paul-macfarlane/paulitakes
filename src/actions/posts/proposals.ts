"use server";

import { z } from "zod";
import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import {
  applyProposalService,
  getProposalService,
  listProposalsService,
  rejectProposalService,
} from "@/lib/proposals/service";
import { selectProposalSchema } from "@/lib/proposals/input";
import { NOT_AUTHORIZED_ERROR } from "@/lib/shared/action-result";

export async function getProposal(id: string) {
  const session = await actionSession(Action.EditPost);
  if (!session) return { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
  if (!z.uuid().safeParse(id).success)
    return { ok: false, error: "Invalid proposal ID." } as const;
  return getProposalService(id, session);
}
export async function listProposals(postId: string) {
  const session = await actionSession(Action.EditPost);
  if (!session) return { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
  if (!z.uuid().safeParse(postId).success)
    return { ok: false, error: "Invalid post ID." } as const;
  return listProposalsService(postId, session);
}
export async function applyProposal(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
  const parsed = selectProposalSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Invalid change selection." } as const;
  return applyProposalService(
    parsed.data.proposalId,
    parsed.data.selectedChangeIds,
    session,
  );
}
export async function rejectProposal(id: string) {
  const session = await actionSession(Action.EditPost);
  if (!session) return { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
  if (!z.uuid().safeParse(id).success)
    return { ok: false, error: "Invalid proposal ID." } as const;
  return rejectProposalService(id, session);
}
