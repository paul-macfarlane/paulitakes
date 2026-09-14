"use client";

import { useContext, useState, useTransition } from "react";

import { transitionPostStatus } from "@/actions/posts/lifecycle";
import { EditorFlushContext } from "@/app/admin/posts/_components/editor-flush-context";
import { Button } from "@/components/ui/button";
import {
  allowedTransitions,
  PostStatus,
  STATUS_LABELS,
  TRANSITION_LABELS,
} from "@/lib/posts/status";
import { cn } from "@/lib/utils";

// Status badge + transition buttons for a saved post. Orthogonal to the
// editor's content autosave (transitionPostStatus touches only status +
// publish/archive timestamps), so the two islands coexist on the edit page.
export function PostStatusControls({
  postId,
  status,
  pendingChanges = false,
}: {
  postId: string;
  status: PostStatus;
  // Draft-of-published (ADR-0011): a public post with unpublished staged edits
  // can't change status until they're published or discarded (the server
  // rejects it too). Disable the buttons and say why.
  pendingChanges?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const flush = useContext(EditorFlushContext);

  function handle(target: PostStatus) {
    setError(null);
    startTransition(async () => {
      try {
        // Save the editor's in-progress edits first — transitionPostStatus
        // only reads the post row, so a "Publish now" click that beats the
        // next autosave tick would otherwise publish stale content.
        const flushed = (await flush?.flush()) ?? true;
        if (!flushed) {
          setError(
            "Couldn't save your latest edits — fix any errors above and try again.",
          );
          return;
        }
        const result = await transitionPostStatus(postId, target);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Lifecycle changes invalidate the loaded edit token. Remount from
        // the server after our own change, but keep beforeunload protection:
        // keystrokes typed after the flush must not be silently discarded.
        window.location.reload();
      } catch {
        // A rejected RPC (network blip) must surface, not leave the controls
        // stuck disabled.
        setError("Something went wrong. Please try again.");
      }
    });
  }

  const busy = isPending || pendingChanges;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Status</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
          {STATUS_LABELS[status]}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {allowedTransitions(status).map((target) => (
          <Button
            key={target}
            type="button"
            size="sm"
            variant={target === PostStatus.Published ? "default" : "outline"}
            disabled={busy}
            onClick={() => handle(target)}
          >
            {TRANSITION_LABELS[target]}
          </Button>
        ))}
      </div>
      <p
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={cn(
          "text-sm",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ??
          (pendingChanges
            ? "Publish or discard your pending changes first."
            : isPending
              ? "Updating…"
              : "")}
      </p>
    </div>
  );
}
