import "server-only";

// Business logic for publishing/discarding a public post's staged edits (its
// post_drafts row, ADR-0011). DB access lives in src/lib/posts/data.ts;
// auth/ownership guarding happens in the thin action
// (src/actions/posts/draft.ts) before these are called.

import { revalidateTag } from "next/cache";

import type { StaffSession } from "@/lib/auth/guards";
import {
  categoryExists,
  discardStagedDraft,
  loadOwnedDraft,
  promoteStagedDraft,
} from "@/lib/posts/data";
import { postDraftSchema } from "@/lib/posts/input";
import {
  CONFLICT_ERROR,
  CONFLICT_RESULT,
  GENERIC_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";
import { IMMEDIATE } from "@/lib/shared/cache";

// Promotes a public post's staged edits (its post_drafts row) to the live
// columns and clears the buffer, in one transaction (ADR-0011). This is the
// only path by which an edit to an already-public post reaches the public —
// so it revalidates the public caches (unlike stageDraftEdit). Idempotent
// when nothing is staged.
export async function publishPostChangesService(
  id: string,
  session: StaffSession,
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const loaded = await loadOwnedDraft(id, session);
    if (!loaded.ok) return loaded;
    const { slug: oldSlug, draft: staged, editVersion } = loaded.post;

    // Nothing staged — idempotent success (a double-click, or already promoted
    // / discarded on another tab).
    if (staged === null) {
      return { ok: true, data: { id, slug: oldSlug } };
    }

    // Re-validate before promoting: the snapshot was validated on write, but
    // never push content onto the live post that we can't fully re-validate.
    const validated = postDraftSchema.safeParse(staged);
    if (!validated.success) {
      return { ok: false, error: validated.error.issues[0]!.message };
    }
    const draft = validated.data;

    // The staged category could have been deleted since it was chosen.
    if (!(await categoryExists(draft.categoryId))) {
      return { ok: false, error: "Unknown category." };
    }

    // CAS on editVersion: a concurrent autosave that re-staged newer edits
    // between our read and here matches no row, so we roll back and report a
    // conflict instead of promoting a stale snapshot and nulling the newer
    // one.
    const promoted = await promoteStagedDraft(id, editVersion, draft);
    if (promoted === "conflict") {
      return { ok: false, error: CONFLICT_ERROR };
    }
    if (promoted === "slug-collision") {
      return { ok: false, error: "That slug is taken." };
    }

    revalidateTag("post-list", IMMEDIATE);
    revalidateTag(`post:${draft.slug}`, IMMEDIATE);
    if (draft.slug !== oldSlug) {
      revalidateTag(`post:${oldSlug}`, IMMEDIATE);
    }

    return { ok: true, data: { id, slug: draft.slug } };
  } catch (err) {
    console.error("publishPostChanges failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// Discards a public post's staged edits (deletes its post_drafts row) without
// touching the live content. No public revalidation — the live post never
// changed. Idempotent when nothing is staged.
export async function discardPostChangesService(
  id: string,
  session: StaffSession,
): Promise<ActionResult<{ id: string }>> {
  try {
    const loaded = await loadOwnedDraft(id, session);
    if (!loaded.ok) return loaded;

    if (loaded.post.draft === null) {
      return { ok: true, data: { id } };
    }

    if (!(await discardStagedDraft(id, loaded.post.editVersion)))
      return CONFLICT_RESULT;

    return { ok: true, data: { id } };
  } catch (err) {
    console.error("discardPostChanges failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
