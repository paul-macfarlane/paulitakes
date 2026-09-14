import { describe, expect, it } from "vitest";
import { applyProposalSelection, createProposalDiff } from "./diff";
import {
  proposalSnapshotSchema,
  proposalNotesSchema,
  submitProposalSchema,
  type ProposalSnapshot,
} from "./input";

const base: ProposalSnapshot = {
  title: "My take",
  slug: "my-take",
  categoryId: 1,
  bodyMd: "First line.\n\nKeep this.\n\nLast line.\n",
  thumbnailUrl: "",
  bannerUrl: null,
  videoUrl: null,
  tags: ["NFL"],
};
describe("complete selectable proposal diffs", () => {
  it("selects separated body hunks and metadata independently", () => {
    const candidate = {
      ...base,
      bodyMd: "Better first line.\n\nKeep this.\n\nBetter last line.\n",
      title: "Better title",
      tags: ["NFL", "Chiefs"],
    };
    const diff = createProposalDiff(base, candidate);
    expect(diff.changes.map((change) => change.id)).toEqual([
      "body:0",
      "body:1",
      "field:title",
      "field:tags",
    ]);
    expect(
      applyProposalSelection(base, candidate, diff, ["body:1", "field:tags"]),
    ).toEqual({
      ...base,
      bodyMd: "First line.\n\nKeep this.\n\nBetter last line.\n",
      tags: ["NFL", "Chiefs"],
    });
    expect(applyProposalSelection(base, candidate, diff, [])).toEqual(base);
    expect(
      applyProposalSelection(
        base,
        candidate,
        diff,
        diff.changes.map((c) => c.id),
      ),
    ).toEqual(candidate);
  });
  it.each([
    ["", "# New\n\nBody"],
    ["Old", ""],
    ["Line", "Line\n"],
    ["Line\n", "Line"],
    ["A\r\nB\r\n", "A\nB\n"],
    ["\n\n", " \n\n"],
    ["🏈 café\n", "🏈 déjà vu\n"],
    ["```ts\nold()\n```\n", "```ts\nnew()\n```\n"],
  ])("preserves exact text: %j → %j", (before, after) => {
    const original = { ...base, bodyMd: before };
    const candidate = { ...base, bodyMd: after };
    const diff = createProposalDiff(original, candidate);
    expect(
      applyProposalSelection(
        original,
        candidate,
        diff,
        diff.changes.map((c) => c.id),
      ),
    ).toEqual(candidate);
    expect(applyProposalSelection(original, candidate, diff, [])).toEqual(
      original,
    );
  });
  it("bounds expensive rewrites without omitting content", () => {
    const original = {
      ...base,
      bodyMd: Array.from({ length: 2000 }, (_, i) => `old-${i}\n`).join(""),
    };
    const candidate = {
      ...base,
      bodyMd: Array.from({ length: 2000 }, (_, i) => `new-${i}\n`).join(""),
    };
    const diff = createProposalDiff(original, candidate);
    expect(diff.wholeBodyReplacement).toBe(true);
    expect(diff.changes).toHaveLength(1);
    expect(
      applyProposalSelection(original, candidate, diff, ["body:0"]),
    ).toEqual(candidate);
  });
  it("rejects forged, repeated or malformed stored selections", () => {
    const candidate = { ...base, bodyMd: "Changed" };
    const diff = createProposalDiff(base, candidate);
    expect(() =>
      applyProposalSelection(base, candidate, diff, ["field:authorId"]),
    ).toThrow();
    expect(() =>
      applyProposalSelection(base, candidate, diff, ["body:0", "body:0"]),
    ).toThrow();
    expect(() =>
      applyProposalSelection(
        { ...base, bodyMd: "Not the base" },
        candidate,
        diff,
        ["body:0"],
      ),
    ).toThrow();
  });
  it("allows note-only reviews without fabricating a content change", () => {
    expect(createProposalDiff(base, base).changes).toEqual([]);
  });
  it("includes every metadata field in the comparison", () => {
    const candidate = {
      ...base,
      title: "New",
      slug: "new",
      categoryId: 2,
      tags: [],
      thumbnailUrl: "https://example.com/a.png",
      bannerUrl: "https://example.com/b.png",
      videoUrl: "https://example.com/v",
    };
    const diff = createProposalDiff(base, candidate);
    expect(diff.changes).toHaveLength(7);
    expect(
      applyProposalSelection(base, candidate, diff, [
        "field:slug",
        "field:bannerUrl",
      ]),
    ).toEqual({ ...base, slug: "new", bannerUrl: candidate.bannerUrl });
  });
});
describe("strict editorial contract", () => {
  it("rejects unknown, lifecycle and incomplete candidate fields", () => {
    expect(
      proposalSnapshotSchema.safeParse({ ...base, status: "published" })
        .success,
    ).toBe(false);
    const missing: Partial<ProposalSnapshot> = { ...base };
    delete missing.slug;
    expect(proposalSnapshotSchema.safeParse(missing).success).toBe(false);
    expect(
      proposalSnapshotSchema.safeParse({
        ...base,
        thumbnailUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });
  it("requires evidence for checked facts but permits explicit unresolved claims", () => {
    const notes = {
      summary: "Language edited; checks incomplete.",
      editorial: [],
      media: [],
      facts: [
        {
          claim: "A record",
          finding: "Not verified",
          status: "unresolved",
          sources: [],
          action: "Check official records.",
        },
      ],
    };
    expect(proposalNotesSchema.safeParse(notes).success).toBe(true);
    expect(
      proposalNotesSchema.safeParse({
        ...notes,
        facts: [{ ...notes.facts[0], status: "verified" }],
      }).success,
    ).toBe(false);
    expect(
      submitProposalSchema.safeParse({
        candidate: base,
        base,
        authorId: "forged",
      }).success,
    ).toBe(false);
  });
});
