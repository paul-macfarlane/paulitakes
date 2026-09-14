"use client";

import {
  useContext,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import {
  cancelScheduledArchive,
  scheduleArchive,
  schedulePublish,
} from "@/actions/posts/lifecycle";
import { EditorFlushContext } from "@/app/admin/posts/_components/editor-flush-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  canScheduleArchive,
  canSchedulePublish,
  PostStatus,
} from "@/lib/posts/status";
import { toDateTimeLocalValue } from "@/lib/shared/datetime";

const subscribeNoop = () => () => {};

// Schedule future publish/archive times (ADM-5). Orthogonal to the editor's
// content autosave and to the immediate status buttons; visibility flips
// automatically when a scheduled time passes (design §4).
export function PostScheduleControls({
  postId,
  status,
  publishAt,
  archiveAt,
  pendingChanges = false,
}: {
  postId: string;
  status: PostStatus;
  publishAt: Date | null;
  archiveAt: Date | null;
  // Draft-of-published (ADR-0011): a public post with unpublished staged edits
  // can't be (re)scheduled until they're published or discarded (server rejects
  // it too). Disable the inputs/buttons and say why.
  pendingChanges?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const flush = useContext(EditorFlushContext);
  // null = the field hasn't been edited yet → show the server value
  // (formatted to the viewer's timezone); a string is the user's own edit.
  const [publishEdit, setPublishEdit] = useState<string | null>(null);
  const [archiveEdit, setArchiveEdit] = useState<string | null>(null);

  // Hydration-safe mounted flag (server snapshot false, client true; same
  // idiom as ThemeToggle). Time-dependent values — local-TZ formatting and
  // `now` — must not render until mounted, or the server (UTC) and browser
  // (viewer TZ) disagree and hydration mismatches. Deriving them from
  // `mounted` during render keeps first client render identical to the server.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // A scheduled post whose publish time has passed is already live (§4);
  // offering "reschedule publish" would invite an accidental un-publish, and
  // the server rejects it anyway. (Only known after mount — `now` is
  // client-only.) Its archive control still applies.
  const scheduledLive =
    mounted &&
    status === PostStatus.Scheduled &&
    publishAt !== null &&
    publishAt <= new Date();
  const showPublish = canSchedulePublish(status) && !scheduledLive;
  const showArchive = canScheduleArchive(status);
  if (!showPublish && !showArchive) return null;

  const minValue = mounted ? toDateTimeLocalValue(new Date()) : undefined;
  const publishValue =
    publishEdit ??
    (mounted && status === PostStatus.Scheduled && publishAt
      ? toDateTimeLocalValue(publishAt)
      : "");
  const archiveValue =
    archiveEdit ??
    (mounted && archiveAt ? toDateTimeLocalValue(archiveAt) : "");

  const busy = isPending || pendingChanges;

  // Runs a scheduling action, surfacing its error or refreshing the page's
  // server data (status + timestamps) on success. Same isPending/try-catch
  // shape as PostStatusControls.
  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        // Save the editor's in-progress edits first — the scheduling actions
        // only read the post row, so a schedule/cancel click that beats the
        // next autosave tick would otherwise act on stale content.
        const flushed = (await flush?.flush()) ?? true;
        if (!flushed) {
          setError(
            "Couldn't save your latest edits — fix any errors above and try again.",
          );
          return;
        }
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        // Drop local edits so both inputs fall back to the refreshed server
        // values — otherwise a just-canceled/rescheduled time lingers in the
        // field and could be re-submitted.
        setPublishEdit(null);
        setArchiveEdit(null);
        // Reinitialize the editor token after this lifecycle write. Do not
        // suppress beforeunload: typing during the action still needs protection.
        window.location.reload();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function submitPublish() {
    if (!publishValue) {
      setError("Pick a publish date and time.");
      return;
    }
    run(() => schedulePublish(postId, new Date(publishValue).toISOString()));
  }

  function submitArchive() {
    if (!archiveValue) {
      setError("Pick an archive date and time.");
      return;
    }
    run(() => scheduleArchive(postId, new Date(archiveValue).toISOString()));
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      {showPublish ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-publish" className="text-sm font-medium">
            Schedule publish
          </Label>
          {mounted && status === PostStatus.Scheduled && publishAt ? (
            <p className="text-sm text-muted-foreground">
              Scheduled to publish {publishAt.toLocaleString()}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="schedule-publish"
              type="datetime-local"
              className="w-auto"
              min={minValue}
              value={publishValue}
              disabled={busy}
              onChange={(event) => setPublishEdit(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={submitPublish}
            >
              {status === PostStatus.Scheduled ? "Reschedule" : "Schedule"}
            </Button>
          </div>
        </div>
      ) : null}

      {showArchive ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-archive" className="text-sm font-medium">
            Schedule archive
          </Label>
          {mounted && archiveAt ? (
            <p className="text-sm text-muted-foreground">
              Scheduled to archive {archiveAt.toLocaleString()}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="schedule-archive"
              type="datetime-local"
              className="w-auto"
              min={minValue}
              value={archiveValue}
              disabled={busy}
              onChange={(event) => setArchiveEdit(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={submitArchive}
            >
              {archiveAt ? "Reschedule" : "Schedule archive"}
            </Button>
            {archiveAt ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => cancelScheduledArchive(postId))}
              >
                Cancel archive
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p
        aria-live="polite"
        role={error ? "alert" : "status"}
        className={
          error
            ? "text-sm text-destructive"
            : pendingChanges
              ? "text-sm text-muted-foreground"
              : "sr-only"
        }
      >
        {error ??
          (pendingChanges
            ? "Publish or discard your pending changes first."
            : isPending
              ? "Saving…"
              : "")}
      </p>
    </div>
  );
}
