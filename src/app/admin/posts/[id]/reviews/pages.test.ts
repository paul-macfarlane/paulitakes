import { describe, expect, it, vi } from "vitest";
import { GENERIC_ERROR } from "@/lib/shared/action-result";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  staff: vi.fn(),
  categories: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireStaff: mocks.staff }));
vi.mock("@/lib/proposals/service", () => ({
  getProposalService: mocks.get,
  listProposalsService: mocks.list,
}));
vi.mock("@/lib/categories/data", () => ({
  listAllCategories: mocks.categories,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("./_components/proposal-review", () => ({
  ProposalReview: () => null,
}));
const { default: listPage } = await import("./page");
const { default: detailPage } = await import("./[proposalId]/page");
const id = "00000000-0000-4000-8000-000000000001";
const proposalId = "00000000-0000-4000-8000-000000000002";

describe("review route failures", () => {
  it.each([GENERIC_ERROR, "Proposal or post not found."])(
    "distinguishes operational errors from missing/inaccessible rows: %s",
    async (error) => {
      mocks.staff.mockResolvedValue({ user: { id: "owner", role: "author" } });
      mocks.get.mockResolvedValue({ ok: false, error });
      mocks.list.mockResolvedValue({ ok: false, error });
      const expected = error === GENERIC_ERROR ? GENERIC_ERROR : "NOT_FOUND";
      await expect(
        listPage({
          params: Promise.resolve({ id }),
          searchParams: Promise.resolve({}),
        }),
      ).rejects.toThrow(expected);
      await expect(
        detailPage({ params: Promise.resolve({ id, proposalId }) }),
      ).rejects.toThrow(expected);
    },
  );
  it("rejects a proposal reached through the wrong post route", async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      data: { proposal: { postId: proposalId } },
    });
    await expect(
      detailPage({ params: Promise.resolve({ id, proposalId }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
