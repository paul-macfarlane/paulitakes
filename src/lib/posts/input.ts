// No "server-only" here (unlike most of src/lib): ADM-2's editor form needs
// these same zod schemas for client-side validation before ADM-3's server
// actions re-validate on the server, which is the actual security boundary.

import { z } from "zod";

import { slugifyTitle, tagToSlug } from "@/lib/shared/slug";

// slugifyTitle/tagToSlug moved to src/lib/shared/slug.ts — slug derivation
// is now shared by the posts and categories domains (SRCH-1). Re-exported
// here so every existing posts-domain import site keeps working unchanged.
export { slugifyTitle, tagToSlug };

// External author-supplied image/video URLs (design §8): https-only, same
// rule as src/lib/image-src.ts's isRenderableImageSrc. One definition —
// image and video URLs share it until a rule ever diverges.
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
export const httpsImageUrl = httpsUrl;

// Base shape with no `.default()`s: `.partial()` in zod v4 still applies
// defaults to keys absent from the input, which would make a title-only
// autosave (postUpdateSchema.parse({ title: "x" })) materialize
// thumbnailUrl/bannerUrl/videoUrl/tags as if the author had explicitly
// cleared them. postInputSchema layers defaults on top of this base for
// create; postUpdateSchema partials the base directly so absent keys stay
// absent.
const basePostInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  // Optional: omitted means the action derives it from title via
  // slugifyTitle. When provided, it's an explicit author choice.
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(1)
    .max(80)
    .optional(),
  // Drafts start blank; max guards against pathological input.
  bodyMd: z.string().max(100_000),
  categoryId: z.number().int().positive(),
  // The column is notNull; drafts may hold "" until publish-time validation
  // (ADM-4/ADM-6) enforces a real image.
  thumbnailUrl: z.union([z.literal(""), httpsImageUrl]),
  // Post-page hero (POST-9); null falls back to thumbnailUrl at render time.
  bannerUrl: httpsImageUrl.nullable(),
  videoUrl: httpsUrl.nullable(),
  // Tag NAMES as typed by the author; slugs are derived server-side with
  // tagToSlug when the tag set is persisted. Rejecting unslugifiable names
  // here (rather than letting them collapse to the same slug at save time)
  // keeps distinct tag inputs from merging into one unrelated tag; near
  // collisions like "café" vs "cafe" still normalize to one tag on purpose.
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(40)
        .refine((name) => tagToSlug(name) !== "", {
          message: "Tags must include a letter or number.",
        }),
    )
    .max(10),
});

// Create: the base validators verbatim (via .shape, so a rule change in the
// base can't drift from this copy) with draft-friendly defaults layered on.
export const postInputSchema = basePostInputSchema.extend({
  thumbnailUrl: basePostInputSchema.shape.thumbnailUrl.default(""),
  bannerUrl: basePostInputSchema.shape.bannerUrl.default(null),
  videoUrl: basePostInputSchema.shape.videoUrl.default(null),
  tags: basePostInputSchema.shape.tags.default([]),
});

// Partial update / autosave: every field optional, no defaults — absent
// keys mean "leave unchanged" (see basePostInputSchema comment above).
export const postUpdateSchema = basePostInputSchema.partial();

// A COMPLETE, publishable content snapshot staged on an already-public post
// (draft-of-published, ADR-0011). postUpdateSchema is a partial autosave diff;
// this is the whole resolved content that "Publish changes" promotes to the
// live columns — so every field is present, the slug is resolved (not
// title-derived), and the thumbnail is REQUIRED (a public post must keep a
// real image, unlike a draft's "" placeholder). Stored in the post_drafts
// row for the post; validated on write and re-validated before promotion.
export const postDraftSchema = z.object({
  title: basePostInputSchema.shape.title,
  // Required here (basePostInputSchema.slug is optional for the derive-from-
  // title path, which doesn't apply to an already-slugged public post).
  slug: basePostInputSchema.shape.slug.unwrap(),
  bodyMd: basePostInputSchema.shape.bodyMd,
  categoryId: basePostInputSchema.shape.categoryId,
  thumbnailUrl: httpsImageUrl,
  bannerUrl: basePostInputSchema.shape.bannerUrl,
  videoUrl: basePostInputSchema.shape.videoUrl,
  tags: basePostInputSchema.shape.tags,
});

// The public post page's [slug] route param: same rule as a post's own slug
// (lowercase, hyphen-separated, capped at 80 — everything slugifyTitle/an
// explicit author-supplied slug can produce), reused rather than
// re-specified so the two schemas can't drift.
export const slugParamSchema = basePostInputSchema.shape.slug.unwrap();

export type PostInput = z.infer<typeof postInputSchema>;
export type PostUpdate = z.infer<typeof postUpdateSchema>;
export type PostDraft = z.infer<typeof postDraftSchema>;

// Opaque mutable-state token, shared by editor saves and future AI proposals.
export const editVersionSchema = z.uuid();
export type SavedPost = { id: string; slug: string; editVersion: string };
