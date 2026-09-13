import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CategoryPills } from "@/app/(public)/_components/category-pills";
import { FeedPagination } from "@/app/(public)/_components/feed-pagination";
import { HomeAnnouncements } from "@/app/(public)/_components/home-announcements";
import { SearchBox } from "@/app/(public)/_components/search-box";
import { ExternalImage } from "@/components/external-image";
import { LocalDate } from "@/components/local-date";
import { PostCard } from "@/components/post-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewBeacon } from "@/components/view-beacon";
import { listActiveCategories } from "@/lib/categories/data";
import {
  getCategoryFeed,
  getHomeFeed,
  HOME_PAGE_SIZE,
} from "@/lib/posts/home-feed";
import {
  searchVisiblePosts,
  SNIPPET_END,
  SNIPPET_START,
  type SearchResult,
} from "@/lib/posts/search";
import {
  homeCanonical,
  searchParamsSchema,
  type SearchPageParams,
} from "@/lib/posts/search-params";

// Canonical/robots derived from the same parsed params the page renders from
// (SEO-10; rules in homeCanonical). Title/description/OG stay inherited from
// the root layout.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { canonical, noindex } = homeCanonical(
    searchParamsSchema.parse(await searchParams),
  );
  return {
    alternates: { canonical },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

// `/` is the single browse/search surface (owner-approved fold of /search and
// /categories/[slug] into home, epic 03 SRCH): optional, combinable `q` and
// `category` query params drive search mode, category-browse mode, or the
// plain feed. Query-dependent per ADR-0008 — the page itself declares no
// `use cache` because it reads searchParams, so that read (and everything it
// drives) sits inside the Suspense boundary below rather than the page
// shell. The underlying feed/search DATA still caches exactly as designed:
// getHomeFeed/getCategoryFeed keep their own `use cache` + `post-list` tag
// (ADR-0018); only the request-dependent presentation (which mode to render,
// pill active state, search box value) is dynamic.
export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-3xl font-bold uppercase tracking-wide">Paulitakes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sports analysis. Stories. Cheap laughs.
      </p>
      {/* Purpose blurb required on the home page itself by Google's OAuth
          branding review (BRAND-4) — the footer's privacy link alone wasn't
          enough for the reviewer. */}
      <p className="mt-3 max-w-prose text-sm text-muted-foreground">
        Sports analysis, stories, and the occasional questionable joke from Paul
        and guest authors. Sign in with Google or Discord to join in with
        comments and likes.{" "}
        <Link
          href="/about"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          About the site
        </Link>
      </p>
      <Suspense fallback={<HomeSkeleton />}>
        <HomeSection searchParams={searchParams} />
      </Suspense>
      <ViewBeacon path="/" />
    </main>
  );
}

// One suspended section for the search box + pills + results: all three
// depend on the same awaited searchParams (and the pills need a fresh
// listActiveCategories), so splitting into separate boundaries would mean
// multiple round trips/skeletons for no benefit — same rationale the old
// /search page used for its single SearchSection.
async function HomeSection({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParamsSchema.parse(await searchParams);
  const categories = await listActiveCategories();

  return (
    <>
      <div className="mt-6">
        <SearchBox q={params.q ?? ""} category={params.category} />
      </div>

      <div className="mt-4">
        <CategoryPills
          categories={categories}
          activeSlug={params.category}
          q={params.q}
        />
      </div>

      <HomeAnnouncements />

      {params.q ? (
        <SearchMode q={params.q} params={params} />
      ) : params.category ? (
        <CategoryMode category={params.category} params={params} />
      ) : (
        <DefaultMode params={params} />
      )}
    </>
  );
}

async function DefaultMode({ params }: { params: SearchPageParams }) {
  const offset = (params.page - 1) * HOME_PAGE_SIZE;
  const { posts, hasMore } = await getHomeFeed(offset);
  return (
    <div className="mt-8 flex flex-col gap-6">
      {posts.length === 0 ? (
        <p className="text-muted-foreground">
          {params.page > 1
            ? "No more posts."
            : "No posts yet. Check back soon."}
        </p>
      ) : (
        posts.map((post) => <PostCard key={post.slug} post={post} />)
      )}
      <FeedPagination
        pathname="/"
        query={{ q: params.q, category: params.category }}
        page={params.page}
        hasMore={hasMore}
      />
    </div>
  );
}

// Unknown/inactive category slug degrades to an empty feed rather than a
// 404 (replaces the old /categories/[slug] 404) — getCategoryFeed does no
// existence/active check by design. Preserves ADR-0017's "a deactivated
// category stays reachable and keeps rendering its posts": deactivation only
// hides the category from listActiveCategories (the pills above), never from
// a direct `?category=` deep link.
async function CategoryMode({
  category,
  params,
}: {
  category: string;
  params: SearchPageParams;
}) {
  const offset = (params.page - 1) * HOME_PAGE_SIZE;
  const { posts, hasMore } = await getCategoryFeed(category, offset);
  return (
    <div className="mt-8 flex flex-col gap-6">
      {posts.length === 0 ? (
        <p className="text-muted-foreground">
          {params.page > 1
            ? "No more posts."
            : "No posts in this category yet."}
        </p>
      ) : (
        posts.map((post) => <PostCard key={post.slug} post={post} />)
      )}
      <FeedPagination
        pathname="/"
        query={{ q: params.q, category: params.category }}
        page={params.page}
        hasMore={hasMore}
      />
    </div>
  );
}

async function SearchMode({
  q,
  params,
}: {
  q: string;
  params: SearchPageParams;
}) {
  const { results, hasMore } = await searchVisiblePosts({
    q,
    categorySlug: params.category,
    limit: HOME_PAGE_SIZE,
    offset: (params.page - 1) * HOME_PAGE_SIZE,
  });

  return (
    <>
      <ResultsList q={q} results={results} />
      <FeedPagination
        pathname="/"
        query={{ q: params.q, category: params.category }}
        page={params.page}
        hasMore={hasMore}
      />
    </>
  );
}

function ResultsList({ q, results }: { q: string; results: SearchResult[] }) {
  if (results.length === 0) {
    return (
      <p className="mt-8 text-muted-foreground">
        No results for &ldquo;{q}&rdquo;.
      </p>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-6">
      {results.map((result) => (
        <li key={result.id}>
          <SearchResultCard result={result} />
        </li>
      ))}
    </ul>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <article className="flex gap-4">
      {/* Duplicate of the title link with no text of its own, same pattern
          as PostCard: hidden from the accessibility tree/tab order rather
          than announced twice. */}
      <Link
        href={`/posts/${result.slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block h-20 w-28 shrink-0 overflow-hidden rounded-md border sm:h-24 sm:w-36"
      >
        <ExternalImage src={result.thumbnailUrl} />
      </Link>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          {result.category.name}
        </p>
        <h2 className="mt-0.5 font-semibold leading-snug">
          <Link href={`/posts/${result.slug}`} className="hover:underline">
            {result.title}
          </Link>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          <LocalDate iso={result.publishAt.toISOString()} />
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          <SnippetText snippet={result.snippet} />
        </p>
      </div>
    </article>
  );
}

// Plain-text snippet with ts_headline's StartSel/StopSel markers (search.ts)
// rendered as <mark> — never dangerouslySetInnerHTML. Split on SNIPPET_START
// first (distinct from SNIPPET_END, so this doesn't get confused by nesting);
// each segment after the first starts with a matched span up to SNIPPET_END.
function SnippetText({ snippet }: { snippet: string }) {
  const [lead, ...matches] = snippet.split(SNIPPET_START);
  return (
    <>
      {lead}
      {matches.map((segment, i) => {
        const [matched, ...rest] = segment.split(SNIPPET_END);
        return (
          <span key={i}>
            <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
              {matched}
            </mark>
            {rest.join(SNIPPET_END)}
          </span>
        );
      })}
    </>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" className="mt-6 flex flex-col gap-6">
      <Skeleton className="h-8 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-14 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-20 w-28 shrink-0 rounded-md sm:h-24 sm:w-36" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
