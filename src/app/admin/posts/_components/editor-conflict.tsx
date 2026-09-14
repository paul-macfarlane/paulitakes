"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function EditorConflict({
  onCopy,
  onExport,
  onReload,
}: {
  onCopy: () => Promise<void>;
  onExport: () => void;
  onReload: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  async function copy() {
    setCopying(true);
    setCopyMessage(null);
    try {
      await onCopy();
      setCopyMessage("Copied your unsaved work as Markdown.");
    } catch {
      setCopyMessage(
        "Couldn't copy to the clipboard. Download your unsaved work instead.",
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <section
      role="alert"
      aria-labelledby="editor-conflict-title"
      className="flex flex-col gap-3 rounded-lg border border-destructive p-4"
    >
      <h2 id="editor-conflict-title" className="font-semibold">
        A newer edit exists
      </h2>
      <p className="text-sm text-muted-foreground">
        Autosave is paused. Your unsaved text and metadata are still here. Copy
        or download your work before loading the latest saved version.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={copy}
          disabled={copying}
        >
          Copy my unsaved work
        </Button>
        <Button type="button" variant="outline" onClick={onExport}>
          Download my unsaved work
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button type="button" variant="outline" />}
          >
            Reload latest
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace your unsaved work?</AlertDialogTitle>
              <AlertDialogDescription>
                Reloading replaces every field with the latest saved version.
                Copy or download your unsaved work first if you want to keep it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing locally</AlertDialogCancel>
              <AlertDialogAction onClick={onReload}>
                Reload and replace
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {copyMessage}
      </p>
    </section>
  );
}
