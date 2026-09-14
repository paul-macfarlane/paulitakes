import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/shared/action-result";
import { z } from "zod";
import { LocalDate } from "@/components/local-date";
import { DateDisplay } from "@/lib/shared/datetime";
import { requireStaff } from "@/lib/auth/session";
import { requirePostIdParam } from "@/lib/admin/route-params";
import { listProposalsService } from "@/lib/proposals/service";
import { PROPOSAL_STATUS_LABELS } from "@/lib/proposals/presentation";

export const metadata: Metadata = {
  title: "AI reviews",
  robots: { index: false, follow: false },
};

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const session = await requireStaff(`/admin/posts/${id}/reviews`);
  const postId = requirePostIdParam(id);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .catch(1)
    .parse((await searchParams).page);
  const result = await listProposalsService(postId, session, page);
  if (!result.ok) {
    if (result.error === GENERIC_ERROR) throw new Error(GENERIC_ERROR);
    notFound();
  }
  return (
    <div className="space-y-6">
      <Link href={`/admin/posts/${postId}/edit`} className="text-sm underline">
        ← Back to editor
      </Link>
      <h1 className="text-2xl font-semibold">AI reviews</h1>
      <p className="text-muted-foreground">
        Reviews suggest changes. You choose what to apply; past reviews stay
        here.
      </p>
      {result.data.length === 0 ? (
        <p>No reviews on this page yet.</p>
      ) : (
        <ul className="space-y-3">
          {result.data.map((proposal) => (
            <li key={proposal.id}>
              <Link
                href={`/admin/posts/${postId}/reviews/${proposal.id}`}
                className="block rounded-lg border p-4 hover:bg-accent"
              >
                <span className="font-medium">
                  {PROPOSAL_STATUS_LABELS[proposal.status]}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {proposal.agentLabel} ·{" "}
                  <LocalDate
                    iso={proposal.createdAt.toISOString()}
                    display={DateDisplay.DateTime}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label="Review history pages"
        className="flex flex-wrap gap-4 text-sm"
      >
        {page > 1 && (
          <Link className="underline" href={`?page=${page - 1}`}>
            Newer reviews
          </Link>
        )}
        {result.data.length === 50 && (
          <Link className="underline" href={`?page=${page + 1}`}>
            Older reviews
          </Link>
        )}
      </nav>
    </div>
  );
}
