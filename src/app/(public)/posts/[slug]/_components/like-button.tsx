"use client";

import { ThumbsUp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/shared/action-result";
import { cn } from "@/lib/utils";

// Transient inline message auto-clears rather than sticking around forever
// (LIKE-2 note: a banned tap gets a graceful message, not a silent no-op, but
// also not a permanent site-wide banner).
const MESSAGE_TIMEOUT_MS = 4000;

type LikeState = { liked: boolean; count: number };

// Shared optimistic like button (LIKE-3, design §5.4 "wired to useOptimistic
// on the client — no client fetching library"), reused by the post page
// footer and every comment row. `onSetLike` is the idempotent desired-state
// action (setPostLike/setCommentLike) — a tap always sends the FULL next
// state (not "toggle"), so replaying it after a rapid re-tap is a no-op
// rather than a double-flip.
export function LikeButton({
  likeCount,
  likedByMe,
  signedIn,
  onSetLike,
  label,
  size = "xs",
}: {
  likeCount: number;
  likedByMe: boolean;
  signedIn: boolean;
  onSetLike: (
    liked: boolean,
  ) => Promise<ActionResult<{ liked: boolean; likeCount: number }>>;
  label: string;
  size?: "xs" | "sm";
}) {
  // Base state seeded once from props on mount, then only ever advanced by
  // an authoritative `ok` response (never re-synced from props afterward) —
  // callers that refetch in the background (e.g. the comment tree) may hand
  // this component stale props on a later render, but re-seeding mid-
  // interaction risks clobbering an in-flight optimistic tap; the base
  // simply stays whatever the last real server response said, which is
  // correct for this component's own taps and self-corrects on remount.
  const [base, setBase] = useState<LikeState>({
    liked: likedByMe,
    count: likeCount,
  });
  const [optimistic, setOptimistic] = useOptimistic(
    base,
    (_current, next: LikeState) => next,
  );
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // Sticky (no timeout), unlike `message`: it holds a link, and a link that
  // vanishes mid-reach is a missed tap.
  const [promptSignIn, setPromptSignIn] = useState(false);
  const pathname = usePathname();
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(
      () => setMessage(null),
      MESSAGE_TIMEOUT_MS,
    );
  }

  function handleClick() {
    if (!signedIn) {
      setPromptSignIn(true);
      return;
    }

    const nextLiked = !optimistic.liked;
    const nextCount = optimistic.count + (nextLiked ? 1 : -1);
    startTransition(async () => {
      setOptimistic({ liked: nextLiked, count: nextCount });
      const result = await onSetLike(nextLiked);
      if (result.ok) {
        // Latest response wins: under rapid taps this may resolve out of
        // request order, but each response carries the server's current
        // truth for THIS actor/target, so the last one to land is always
        // at least as fresh as this component needs (idempotent set
        // semantics, not a queued diff).
        setBase({ liked: result.data.liked, count: result.data.likeCount });
      } else {
        showMessage(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-pressed={optimistic.liked}
        aria-label={`Like this ${label}`}
        onClick={handleClick}
      >
        <ThumbsUp
          className={cn(optimistic.liked && "fill-current text-destructive")}
        />
        <span className="text-muted-foreground">{optimistic.count}</span>
      </Button>
      {promptSignIn ? (
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          <Link
            href={`/sign-in?next=${encodeURIComponent(pathname)}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Sign in
          </Link>{" "}
          to like this.
        </p>
      ) : (
        message && (
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            {message}
          </p>
        )
      )}
    </div>
  );
}
