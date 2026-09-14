import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/shared/action-result";
import { requireStaff } from "@/lib/auth/session";
import { requirePostIdParam } from "@/lib/admin/route-params";
import { getProposalService } from "@/lib/proposals/service";
import { listAllCategories } from "@/lib/categories/data";
import { ProposalReview } from "../_components/proposal-review";

export const metadata: Metadata = {
  title: "Review suggestions",
  robots: { index: false, follow: false },
};
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; proposalId: string }>;
}) {
  const { id, proposalId } = await params;
  const session = await requireStaff(
    `/admin/posts/${id}/reviews/${proposalId}`,
  );
  const postId = requirePostIdParam(id);
  const parsedProposalId = requirePostIdParam(proposalId);
  const result = await getProposalService(parsedProposalId, session);
  if (!result.ok) {
    if (result.error === GENERIC_ERROR) throw new Error(GENERIC_ERROR);
    notFound();
  }
  if (result.data.proposal.postId !== postId) notFound();
  const categories = await listAllCategories();
  return (
    <div className="space-y-6">
      <Link
        className="text-sm underline"
        href={`/admin/posts/${postId}/reviews`}
      >
        ← All reviews
      </Link>
      <ProposalReview
        key={result.data.proposal.id}
        {...result.data}
        categories={categories.map(({ id, name }) => ({ id, name }))}
      />
    </div>
  );
}
