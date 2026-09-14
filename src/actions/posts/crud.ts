"use server";

// Server actions are the security boundary (design §8, §9): assume hostile
// input on every call, never trust the client, and re-check session + role
// + ownership per action — middleware/UI gating is convenience only.

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import {
  editVersionSchema,
  postInputSchema,
  postUpdateSchema,
  type SavedPost,
} from "@/lib/posts/input";
import {
  createPostService,
  deletePostService,
  updatePostService,
} from "@/lib/posts/service/crud";
import {
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

export async function createPost(
  input: unknown,
): Promise<ActionResult<SavedPost>> {
  // Session/role checked before parsing input: an unauthenticated or
  // unauthorized caller gets only "Not authorized.", never field-level
  // validation feedback (or a 100KB body parsed) for input it was never
  // entitled to submit (engineering rules: session -> role -> everything
  // else).
  const session = await actionSession(Action.CreatePost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const parsed = postInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  return createPostService(parsed.data, session.user.id);
}

export async function updatePost(
  id: string,
  input: unknown,
  expectedVersion: string,
): Promise<ActionResult<SavedPost>> {
  // Session/role checked before parsing anything: an unauthenticated or
  // unauthorized caller gets only "Not authorized.", never field-level
  // validation feedback (engineering rules: session -> role -> everything
  // else).
  const session = await actionSession(Action.EditPost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  const parsed = postUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  const version = editVersionSchema.safeParse(expectedVersion);
  if (!version.success) {
    return { ok: false, error: "Reload this editor before saving." };
  }

  return updatePostService(idResult.data, parsed.data, session, version.data);
}

export async function deletePost(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  // Session/role checked before parsing the id (engineering rules: session
  // -> role -> everything else) — an unauthenticated or unauthorized caller
  // gets only "Not authorized.", never id-format validation feedback.
  // Admins hard-delete any post; authors may hard-delete only their own
  // never-public, comment-free posts (draft/scheduled, never actually gone
  // live) — otherwise they archive instead, which is recoverable
  // (ADM-4/FR-7.6). deletePostService enforces the exact scoping.
  const session = await actionSession(Action.DeletePost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
  }

  const idResult = z.uuid().safeParse(id);
  if (!idResult.success) {
    return { ok: false, error: idResult.error.issues[0]!.message };
  }

  return deletePostService(session, idResult.data);
}
