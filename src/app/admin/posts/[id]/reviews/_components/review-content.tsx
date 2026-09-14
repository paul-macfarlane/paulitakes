import type { ProposalNotes, ProposalSnapshot } from "@/lib/proposals/input";
import { METADATA_FIELDS } from "@/lib/proposals/diff";
import {
  displayField,
  FIELD_LABELS,
  type ReviewCategory,
} from "@/lib/proposals/presentation";
import { PostBody } from "@/components/post-body";
import { LiteYouTubeActivation } from "@/components/lite-youtube-activation";
import "lite-youtube-embed/src/lite-yt-embed.css";

export function ExactText({ text }: { text: string }) {
  return (
    <div className="min-w-0">
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm [overflow-wrap:anywhere]">
        {text || "(empty)"}
      </pre>
      <p className="mt-1 text-xs text-muted-foreground">
        {text.length} characters ·{" "}
        {text.endsWith("\n") ? "ends with a newline" : "no final newline"}
        {text.includes("\r\n") ? " · contains CRLF line endings" : ""}
      </p>
    </div>
  );
}

export function SnapshotContent({
  snapshot,
  categories,
  html,
}: {
  snapshot: ProposalSnapshot;
  categories: ReviewCategory[];
  html?: string;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <dl className="space-y-3 text-sm">
        {METADATA_FIELDS.map((field) => (
          <div key={field}>
            <dt className="font-medium">{FIELD_LABELS[field]}</dt>
            <dd className="whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
              {displayField(field, snapshot[field], categories)}
            </dd>
          </div>
        ))}
      </dl>
      {html === undefined ? (
        <ExactText text={snapshot.bodyMd} />
      ) : (
        <div
          className="min-w-0 overflow-x-auto"
          data-testid="rendered-selection"
        >
          <LiteYouTubeActivation />
          <PostBody html={html} />
        </div>
      )}
    </div>
  );
}

function SourceLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words underline [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  );
}

export function ReviewNotes({ notes }: { notes: ProposalNotes }) {
  return (
    <section aria-labelledby="review-notes-heading" className="space-y-5">
      <h2 id="review-notes-heading" className="text-xl font-semibold">
        Editorial notes
      </h2>
      <p className="text-sm text-muted-foreground">
        These notes stay with the review. Applying changes does not add them to
        your article. Fact-check labels are the agent’s assessments; check the
        linked evidence.
      </p>
      <p className="whitespace-pre-wrap break-words">{notes.summary}</p>
      {notes.editorial.length > 0 && (
        <ul className="list-disc space-y-2 pl-5">
          {notes.editorial.map((note, index) => (
            <li className="whitespace-pre-wrap break-words" key={index}>
              {note}
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-lg font-semibold">Fact-check notes</h3>
      {notes.facts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No fact-check notes supplied.
        </p>
      )}
      {notes.facts.map((fact, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border p-4 text-sm [overflow-wrap:anywhere]"
        >
          <p className="font-medium capitalize">{fact.status}</p>
          <p>
            <strong>Claim: </strong>
            {fact.claim}
          </p>
          <p>
            <strong>Finding: </strong>
            {fact.finding}
          </p>
          <p>
            <strong>Suggested action: </strong>
            {fact.action}
          </p>
          {fact.sources.length > 0 && (
            <ul className="space-y-1">
              {fact.sources.map((source, i) => (
                <li key={i}>
                  <SourceLink href={source}>{source}</SourceLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <h3 className="text-lg font-semibold">Media suggestions</h3>
      {notes.media.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No media suggestions supplied.
        </p>
      )}
      {notes.media.map((media, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border p-4 text-sm [overflow-wrap:anywhere]"
        >
          <p>{media.suggestion}</p>
          {media.sourceUrl && (
            <p>
              <SourceLink href={media.sourceUrl}>Source / context</SourceLink>
            </p>
          )}
          {media.mediaUrl && (
            <p>
              <SourceLink href={media.mediaUrl}>
                View suggested media
              </SourceLink>
            </p>
          )}
          <p>
            <strong>Credit: </strong>
            {media.credit}
          </p>
          <p>
            <strong>Alt text: </strong>
            {media.altText}
          </p>
          <p>
            <strong>Usage / permission: </strong>
            {media.permission}
          </p>
        </div>
      ))}
    </section>
  );
}
