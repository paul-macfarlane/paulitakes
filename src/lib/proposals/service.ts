import "server-only";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import type { StaffSession } from "@/lib/auth/guards";
import { Action, canPerformAction } from "@/lib/auth/permissions";
import {
  isPostSlugCollision,
  type ExistingPostForUpdate,
  type Tx,
} from "@/lib/posts/data";
import { postDraftSchema, type SavedPost } from "@/lib/posts/input";
import { isPubliclyVisible, PUBLIC_STATUSES } from "@/lib/posts/status";
import {
  CONFLICT_RESULT,
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";
import { IMMEDIATE } from "@/lib/shared/cache";
import { applyProposalSelection, createProposalDiff } from "./diff";
import {
  closeProposal,
  findOpenProposal,
  insertProposal,
  listProposalSummaries,
  loadSnapshots,
  snapshotReferencesValid,
  withLockedProposal,
  withLockedSource,
  writeSelectedSnapshot,
  type ProposalRow,
} from "./data";
import {
  ProposalOrigin,
  ProposalStatus,
  proposalSnapshotSchema,
  submitProposalSchema,
  type ProposalSnapshot,
} from "./input";

const NOT_FOUND = { ok: false, error: "Proposal or post not found." } as const;
const principalSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    label: z.string().trim().min(1).max(100),
  })
  .strict();
// AIR-5's isolated auth boundary supplies this principal; never take it from
// proposal payloads. No HTTP route or human creation action exposes this yet.
export type ProposalAgent = z.infer<typeof principalSchema>;

export function snapshotsEqual(
  a: ProposalSnapshot,
  b: ProposalSnapshot,
): boolean {
  return (Object.keys(a) as (keyof ProposalSnapshot)[]).every(
    (key) => JSON.stringify(a[key]) === JSON.stringify(b[key]),
  );
}
function stale(proposal: ProposalRow, post: ExistingPostForUpdate): boolean {
  return (
    proposal.sourceVersion !== post.editVersion ||
    proposal.sourceIsPublic !== isPubliclyVisible(post)
  );
}
function mayEdit(session: StaffSession, post: ExistingPostForUpdate): boolean {
  return (
    canPerformAction(session.user, Action.EditPost) &&
    (canPerformAction(session.user, Action.ManageAnyPost) ||
      session.user.id === post.authorId)
  );
}
function failure(operation: string, error: unknown): ActionResult<never> {
  // Database exceptions can contain full INSERT parameters. Never log those
  // here: proposals contain private drafts and fact-check notes.
  console.error(`${operation} failed`);
  return {
    ok: false,
    error: isPostSlugCollision(error) ? "That slug is taken." : GENERIC_ERROR,
  };
}

export async function submitProposalService(
  principal: ProposalAgent,
  input: unknown,
): Promise<ActionResult<ProposalRow>> {
  const actor = principalSchema.safeParse(principal);
  const parsed = submitProposalSchema.safeParse(input);
  if (!actor.success || !parsed.success)
    return { ok: false, error: "Invalid proposal." };
  const data = parsed.data;
  try {
    return (
      (await withLockedSource<ActionResult<ProposalRow>>(
        data.postId,
        async (tx, post) => {
          if (post.editVersion !== data.sourceVersion) return CONFLICT_RESULT;
          const sourceIsPublic = isPubliclyVisible(post);
          const snapshots = await loadSnapshots(tx, data.postId, post);
          const base = proposalSnapshotSchema.parse(snapshots.effective);
          const candidate = data.candidate;
          if (
            (PUBLIC_STATUSES as readonly string[]).includes(post.status) &&
            !postDraftSchema.safeParse(candidate).success
          )
            return {
              ok: false,
              error: "A published or scheduled post must keep its thumbnail.",
            };
          const invalid = await snapshotReferencesValid(
            tx,
            data.postId,
            candidate,
          );
          if (invalid) return { ok: false, error: invalid };
          const diff = createProposalDiff(base, candidate);
          const open = await findOpenProposal(tx, data.postId);
          if (open && open.id !== data.supersedesProposalId)
            return {
              ok: false,
              code: CONFLICT_RESULT.code,
              error: "This post already has an open proposal.",
            };
          if (
            data.supersedesProposalId &&
            open?.id !== data.supersedesProposalId
          )
            return CONFLICT_RESULT;
          if (isPubliclyVisible(post) !== sourceIsPublic)
            return CONFLICT_RESULT;
          if (open)
            await closeProposal(tx, open.id, {
              status: ProposalStatus.Superseded,
            });
          return {
            ok: true,
            data: await insertProposal(tx, {
              postId: data.postId,
              origin: ProposalOrigin.Agent,
              agentId: actor.data.id,
              agentLabel: actor.data.label,
              skill: data.skill,
              sourceVersion: data.sourceVersion,
              sourceIsPublic,
              base,
              candidate,
              diff,
              notes: data.notes,
            }),
          };
        },
      )) ?? NOT_FOUND
    );
  } catch (error) {
    return failure("submitProposal", error);
  }
}

async function ownedProposal<T>(
  id: string,
  session: StaffSession,
  run: (
    tx: Tx,
    post: ExistingPostForUpdate,
    proposal: ProposalRow,
  ) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!canPerformAction(session.user, Action.EditPost))
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  return (
    (await withLockedProposal<ActionResult<T>>(
      id,
      async (tx, post, proposal) => {
        if (!mayEdit(session, post)) return NOT_FOUND;
        return run(tx, post, proposal);
      },
    )) ?? NOT_FOUND
  );
}

export async function getProposalService(id: string, session: StaffSession) {
  try {
    return await ownedProposal(id, session, async (_tx, post, proposal) => ({
      ok: true,
      data: {
        proposal,
        stale: stale(proposal, post),
        postStatus: post.status,
        publishAt: post.publishAt,
      },
    }));
  } catch (error) {
    return failure("getProposal", error);
  }
}
export async function listProposalsService(
  postId: string,
  session: StaffSession,
  page = 1,
) {
  try {
    if (!canPerformAction(session.user, Action.EditPost))
      return { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
    return (
      (await withLockedSource(postId, async (tx, post) => {
        if (!mayEdit(session, post)) return NOT_FOUND;
        return {
          ok: true,
          data: await listProposalSummaries(tx, postId, page),
        } as const;
      })) ?? NOT_FOUND
    );
  } catch (error) {
    return failure("listProposals", error);
  }
}

export async function applyProposalService(
  id: string,
  selectedIds: string[],
  session: StaffSession,
): Promise<ActionResult<SavedPost>> {
  try {
    const result = await ownedProposal(
      id,
      session,
      async (
        tx,
        post,
        proposal,
      ): Promise<
        ActionResult<SavedPost & { staged: boolean; oldSlug: string }>
      > => {
        if (proposal.status !== ProposalStatus.Open || stale(proposal, post))
          return CONFLICT_RESULT;
        let selected: ProposalSnapshot;
        try {
          if (!selectedIds.length)
            return {
              ok: false,
              error: "Select at least one change, or reject this proposal.",
            };
          selected = proposalSnapshotSchema.parse(
            applyProposalSelection(
              proposal.base,
              proposal.candidate,
              proposal.diff,
              selectedIds,
            ),
          );
        } catch {
          return { ok: false, error: "Invalid change selection." };
        }
        const staged = proposal.sourceIsPublic;
        if (
          (PUBLIC_STATUSES as readonly string[]).includes(post.status) &&
          !postDraftSchema.safeParse(selected).success
        )
          return {
            ok: false,
            error: "A published or scheduled post must keep its thumbnail.",
          };
        const invalid = await snapshotReferencesValid(
          tx,
          proposal.postId,
          selected,
        );
        if (invalid) return { ok: false, error: invalid };
        const snapshots = await loadSnapshots(tx, proposal.postId, post);
        if (!snapshotsEqual(proposal.base, snapshots.effective))
          return CONFLICT_RESULT;
        const version = await writeSelectedSnapshot(
          tx,
          proposal.postId,
          post,
          selected,
          staged,
          snapshotsEqual(selected, snapshots.live),
        );
        if (!version) return CONFLICT_RESULT;
        await closeProposal(tx, id, {
          status: ProposalStatus.Applied,
          decidedBy: session.user.id,
          acceptedChangeIds: selectedIds,
          rejectedChangeIds: proposal.diff.changes
            .filter((change) => !selectedIds.includes(change.id))
            .map((change) => change.id),
          appliedVersion: version,
        });
        return {
          ok: true,
          data: {
            id: proposal.postId,
            slug: selected.slug,
            editVersion: version,
            staged,
            oldSlug: post.slug,
          },
        };
      },
    );
    if (!result.ok) return result;
    if (!result.data.staged) {
      revalidateTag("post-list", IMMEDIATE);
      revalidateTag(`post:${result.data.slug}`, IMMEDIATE);
      if (result.data.oldSlug !== result.data.slug)
        revalidateTag(`post:${result.data.oldSlug}`, IMMEDIATE);
    }
    return {
      ok: true,
      data: {
        id: result.data.id,
        slug: result.data.slug,
        editVersion: result.data.editVersion,
      },
    };
  } catch (error) {
    return failure("applyProposal", error);
  }
}
export async function rejectProposalService(
  id: string,
  session: StaffSession,
): Promise<ActionResult<{ id: string }>> {
  try {
    return await ownedProposal(id, session, async (tx, _post, proposal) => {
      if (proposal.status !== ProposalStatus.Open) return CONFLICT_RESULT;
      await closeProposal(tx, id, {
        status: ProposalStatus.Rejected,
        decidedBy: session.user.id,
        acceptedChangeIds: [],
        rejectedChangeIds: proposal.diff.changes.map((change) => change.id),
      });
      return { ok: true, data: { id } };
    });
  } catch (error) {
    return failure("rejectProposal", error);
  }
}
