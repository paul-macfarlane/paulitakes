import { z } from "zod";
import {
  editVersionSchema,
  postDraftSchema,
  postInputSchema,
} from "@/lib/posts/input";

// Required resolved fields, including draft-friendly thumbnails; no lifecycle,
// ownership or moderation fields can enter an agent's candidate snapshot.
export const proposalSnapshotSchema = postDraftSchema
  .extend({
    thumbnailUrl: postInputSchema.shape.thumbnailUrl.removeDefault(),
  })
  .strict();
export type ProposalSnapshot = z.infer<typeof proposalSnapshotSchema>;

export const ProposalStatus = {
  Open: "open",
  Applied: "applied",
  Rejected: "rejected",
  Superseded: "superseded",
} as const;
export const ProposalOrigin = { Agent: "agent" } as const;
export const FactStatus = {
  Verified: "verified",
  Corrected: "corrected",
  Unresolved: "unresolved",
} as const;
const noteText = z.string().trim().min(1).max(4000);
const sourceUrl = z.url({ protocol: /^https?$/ }).max(2048);
export const proposalNotesSchema = z
  .object({
    summary: noteText,
    changes: z
      .array(
        z
          .object({
            changeId: z.string().min(1).max(80),
            before: z.string().max(100000),
            after: z.string().max(100000),
            explanation: noteText,
            sources: z.array(sourceUrl).max(10),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
    editorial: z.array(noteText).max(50),
    facts: z
      .array(
        z
          .object({
            claim: noteText,
            finding: noteText,
            status: z.enum(FactStatus),
            sources: z.array(sourceUrl).max(10),
            action: noteText,
          })
          .strict()
          .refine(
            (note) =>
              note.status === FactStatus.Unresolved || note.sources.length > 0,
            {
              message: "Verified or corrected facts require a source.",
            },
          ),
      )
      .max(100),
    media: z
      .array(
        z
          .object({
            suggestion: noteText,
            sourceUrl: sourceUrl.nullable(),
            mediaUrl: sourceUrl.nullable(),
            credit: noteText,
            altText: noteText,
            permission: noteText,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ProposalNotes = z.infer<typeof proposalNotesSchema>;
export const skillAttributionSchema = z
  .object({
    name: z.literal("paulitakes-editor"),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SkillAttribution = z.infer<typeof skillAttributionSchema>;
export const submitProposalSchema = z
  .object({
    postId: z.uuid(),
    sourceVersion: editVersionSchema,
    candidate: proposalSnapshotSchema,
    notes: proposalNotesSchema,
    skill: skillAttributionSchema,
    supersedesProposalId: z.uuid().optional(),
  })
  .strict();
export type SubmitProposal = z.infer<typeof submitProposalSchema>;
export const selectProposalSchema = z
  .object({
    proposalId: z.uuid(),
    selectedChangeIds: z
      .array(z.string().max(80))
      .min(1)
      .max(1000)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate change IDs.",
      ),
  })
  .strict();
