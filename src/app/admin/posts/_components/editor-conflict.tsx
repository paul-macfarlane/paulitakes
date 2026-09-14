"use client";

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
  onExport,
  onReload,
}: {
  onExport: () => void;
  onReload: () => void;
}) {
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
        Autosave is paused. Your unsaved text and metadata are still here.
        Download a copy before loading the latest saved version.
      </p>
      <div className="flex flex-wrap gap-2">
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
                Download your unsaved work first if you want to keep it.
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
    </section>
  );
}
