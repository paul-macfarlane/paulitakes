"use client";

import { useContext, useState } from "react";
import { EditorFlushContext } from "@/app/admin/posts/_components/editor-flush-context";
import { Button } from "@/components/ui/button";

export function ReviewNavigation({ postId }: { postId: string }) {
  const editor = useContext(EditorFlushContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function openReviews() {
    setPending(true);
    setError(null);
    try {
      if (!editor || !(await editor.flush())) {
        setError(
          "Save your edits or resolve the save conflict before opening reviews.",
        );
        return;
      }
      // A full navigation retains beforeunload protection for keystrokes
      // typed while the save was in flight. Never suppress that warning.
      window.location.assign(`/admin/posts/${postId}/reviews`);
    } catch {
      setError("Couldn't open reviews. Your writing is still here; try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rounded-lg border p-4">
      <Button
        variant="outline"
        onClick={() => void openReviews()}
        disabled={pending}
      >
        {pending ? "Saving…" : "Reviews"}
      </Button>
      <p className="mt-2 text-sm text-muted-foreground">
        Compare suggestions and choose what to keep. Your edits save before you
        leave.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
