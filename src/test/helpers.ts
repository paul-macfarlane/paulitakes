// Shared fixtures/setup for DB-backed and session-mocked Vitest suites
// (actions + src/lib/posts/*). Deliberately NOT *.test.ts so Vitest never
// collects it as a spec, and nothing outside tests imports it.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray, like, lt, notExists, sql } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";

import * as schema from "@/db/schema";

export type TestDb = NodePgDatabase<typeof schema>;

// vi.hoisted-friendly factory: each test file still does
// `const { pool, testDb } = await vi.hoisted(() => createTestDb());` itself
// (vi.mock factories are hoisted above regular imports/consts in THAT file,
// so the call site — not this helper — must live inside vi.hoisted). This
// just dedupes the pool/drizzle wiring that used to be copy-pasted per file.
export async function createTestDb(): Promise<{
  pool: import("pg").Pool;
  testDb: TestDb;
}> {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const { testDatabaseUrl } = await import("@/test/db-url");
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  return { pool, testDb: drizzle(pool, { schema }) };
}

// Hygiene sweep of leftovers from runs that died before their afterAll ran.
// Age-gated (and, for tags/categories, reference-gated — neither table has a
// createdAt column) so a concurrent run's fresh rows are never touched.
// Assertions never depend on this sweep running — isolation comes from each
// run's unique runId — so it's arrange-only, same as before extraction.
export async function sweepStalePostFixtures(
  testDb: TestDb,
  opts: { seedPrefix: string; tagSlugPattern?: string },
): Promise<void> {
  const { posts, tags, categories, user, postTags } = schema;
  const tagSlugPattern = opts.tagSlugPattern ?? `${opts.seedPrefix}%`;
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000);

  await testDb
    .delete(posts)
    .where(
      and(
        like(posts.slug, `${opts.seedPrefix}%`),
        lt(posts.createdAt, staleBefore),
      ),
    );
  await testDb.delete(tags).where(
    and(
      like(tags.slug, tagSlugPattern),
      notExists(
        testDb
          .select({ one: sql`1` })
          .from(postTags)
          .where(eq(postTags.tagId, tags.id)),
      ),
    ),
  );
  await testDb.delete(categories).where(
    and(
      like(categories.slug, `cat-${opts.seedPrefix}%`),
      notExists(
        testDb
          .select({ one: sql`1` })
          .from(posts)
          .where(eq(posts.categoryId, categories.id)),
      ),
    ),
  );
  await testDb
    .delete(user)
    .where(
      and(
        like(user.id, `user-${opts.seedPrefix}%`),
        lt(user.createdAt, staleBefore),
      ),
    );
}

export interface StaffFixtureIds {
  authorId: string;
  adminId: string;
  readerId: string;
  categoryId: number;
}

// Seeds the author/admin/reader trio + one category that the posts-action
// test files (crud/draft/lifecycle) each need under their own runId. Callers
// that don't exercise a particular role (e.g. draft.test.ts never asserts
// against adminId) simply don't destructure that field — the row still
// exists for referential/authz-scoping realism and is cleaned up by
// clearStaffFixtures.
export async function seedStaffFixtures(
  testDb: TestDb,
  runId: string,
): Promise<StaffFixtureIds> {
  const { categories, user } = schema;
  const authorId = `user-${runId}-author`;
  const adminId = `user-${runId}-admin`;
  const readerId = `user-${runId}-reader`;

  await testDb.insert(user).values([
    {
      id: authorId,
      name: `Test Author ${runId}`,
      email: `author-${runId}@example.com`,
      role: "author",
    },
    {
      id: adminId,
      name: `Test Admin ${runId}`,
      email: `admin-${runId}@example.com`,
      role: "admin",
    },
    {
      id: readerId,
      name: `Test Reader ${runId}`,
      email: `reader-${runId}@example.com`,
      role: "reader",
    },
  ]);

  const [category] = await testDb
    .insert(categories)
    .values({ slug: `cat-${runId}`, name: `Category ${runId}` })
    .returning({ id: categories.id });

  return { authorId, adminId, readerId, categoryId: category!.id };
}

// Mirror of seedStaffFixtures for afterAll — deletes exactly what it created.
export async function clearStaffFixtures(
  testDb: TestDb,
  ids: StaffFixtureIds,
): Promise<void> {
  const { categories, user } = schema;
  await testDb
    .delete(user)
    .where(inArray(user.id, [ids.authorId, ids.adminId, ids.readerId]));
  await testDb.delete(categories).where(eq(categories.id, ids.categoryId));
}

export type SessionRole = "reader" | "author" | "admin";

// Builds the `{ user }` shape the mocked "@/lib/auth/session" getSession()
// returns. Test files still declare their own `vi.hoisted` sessionMock
// object and `vi.mock("@/lib/auth/session", ...)` call (mock factories must
// be hoisted within the file that registers them) — this just dedupes the
// repeated session-value literal.
export function sessionUser(
  id: string,
  role: SessionRole,
  bannedAt: Date | null = null,
) {
  return { user: { id, role, bannedAt } };
}

// The staged-draft buffer lives in its own 1:1 table (ADR-0012). Shared
// loader for the "draft storage internals" assertions in crud.test.ts and
// draft.test.ts (undefined means no pending changes).
export function draftRowLoader(testDb: TestDb) {
  const { postDrafts } = schema;
  return async function loadDraftRow(postId: string) {
    const [row] = await testDb
      .select()
      .from(postDrafts)
      .where(eq(postDrafts.postId, postId));
    return row;
  };
}

// NOTE on what can (and can't) move here: `vi.hoisted`/`vi.mock` calls stay
// in each test file — Vitest hoists them above that file's own imports, not
// above an imported helper's, so a shared "bootstrap" wrapping them would
// silently stop being hoisted and break the mock. What CAN live here is
// anything vi.hoisted/vi.mock *reference* or call afterward: pool/db wiring
// (createTestDb), fixture seeding, and — below — the beforeAll/afterAll
// lifecycle plumbing itself (Vitest hooks are ordinary function calls, not
// hoisted, so calling them from inside a helper works fine).

type SessionIds = Pick<StaffFixtureIds, "authorId" | "adminId" | "readerId">;

// Builds the four settable-session helpers (`authorSession`/`adminSession`/
// `readerSession`/`noSession`) that action tests flip per case. `getIds` is
// a thunk, not a plain value, because callers declare `let ids` and only
// populate it once seeding finishes in `beforeAll` — resolving lazily means
// these functions work whether they're wired up before or after that
// assignment. Preview has no DB fixtures, so its ids default to a static
// "user-1".
export function sessionSetters(
  sessionMock: { current: unknown },
  getIds: () => SessionIds = () => ({
    authorId: "user-1",
    adminId: "user-1",
    readerId: "user-1",
  }),
) {
  return {
    authorSession() {
      sessionMock.current = sessionUser(getIds().authorId, "author");
    },
    adminSession() {
      sessionMock.current = sessionUser(getIds().adminId, "admin");
    },
    readerSession() {
      sessionMock.current = sessionUser(getIds().readerId, "reader");
    },
    noSession() {
      sessionMock.current = null;
    },
  };
}

// Dedupes the SEED_PREFIX+runId / beforeAll(sweep+seed) / afterAll(delete
// posts+tags by slug prefix, clear staff fixtures, pool.end) wiring shared
// by the posts-action test trio (crud/draft/lifecycle). `runId` is returned
// synchronously (it needs no DB round trip); `ids` is only known once
// seeding finishes, so it's handed back through `onSeeded` instead — call
// sites keep their own `let ids: StaffFixtureIds` (as before extraction) and
// assign it there, so every existing `ids.xxx` reference elsewhere in the
// file keeps working unchanged.
export function registerPostSuiteLifecycle(opts: {
  testDb: TestDb;
  pool: import("pg").Pool;
  prefix: string;
  onSeeded?: (ids: StaffFixtureIds) => void;
}): { runId: string } {
  const { testDb, pool, prefix } = opts;
  const runId = `${prefix}${crypto.randomUUID().slice(0, 8)}`;
  let ids: StaffFixtureIds;

  beforeAll(async () => {
    await sweepStalePostFixtures(testDb, { seedPrefix: prefix });
    ids = await seedStaffFixtures(testDb, runId);
    opts.onSeeded?.(ids);
  });

  afterAll(async () => {
    const { posts, tags } = schema;
    await testDb.delete(posts).where(like(posts.slug, `${runId}%`));
    await testDb.delete(tags).where(like(tags.slug, `${runId}%`));
    await clearStaffFixtures(testDb, ids);
    await pool.end();
  });

  return { runId };
}

export interface SeedPostOptions {
  runId: string;
  suffix: string;
  authorId: string;
  categoryId: number;
  bodyMd?: string;
  thumbnailUrl?: string;
  status?: (typeof schema.posts.$inferInsert)["status"];
  publishAt?: Date | null;
  archiveAt?: Date | null;
}

// One shared post-row factory for the posts-action test trio. Columns are
// only included in the insert when the caller passes them explicitly (same
// as each file's old bespoke seeder), so an omitted `status`/`publishAt`/
// `archiveAt` still falls through to the schema default instead of an
// explicit value.
export async function seedPost(
  testDb: TestDb,
  opts: SeedPostOptions,
): Promise<{ id: string; slug: string }> {
  const { posts } = schema;
  const values: typeof posts.$inferInsert = {
    authorId: opts.authorId,
    title: `${opts.runId} ${opts.suffix}`,
    slug: `${opts.runId}-${opts.suffix}`,
    bodyMd: opts.bodyMd ?? "Body.",
    thumbnailUrl: opts.thumbnailUrl ?? "",
    categoryId: opts.categoryId,
  };
  if (opts.status !== undefined) values.status = opts.status;
  if (opts.publishAt !== undefined) values.publishAt = opts.publishAt;
  if (opts.archiveAt !== undefined) values.archiveAt = opts.archiveAt;

  const [row] = await testDb
    .insert(posts)
    .values(values)
    .returning({ id: posts.id, slug: posts.slug });
  return row!;
}

export async function loadEditVersion(
  testDb: TestDb,
  postId: string,
): Promise<string> {
  const [row] = await testDb
    .select({ version: schema.posts.editVersion })
    .from(schema.posts)
    .where(eq(schema.posts.id, postId));
  if (!row) throw new Error("Missing synthetic post");
  return row.version;
}

// Existing behavior suites model a fresh editor per save. Concurrency suites
// must retain and explicitly submit an earlier token instead of using this helper.
export function freshPostUpdater(
  testDb: TestDb,
  update: typeof import("@/actions/posts/crud").updatePost,
) {
  return async (id: string, input: unknown) =>
    update(id, input, await loadEditVersion(testDb, id));
}
