import { cn } from 'cn';

export function PhonePreview({
  from,
  to,
  body,
  draft,
  busy,
}: {
  from: string;
  to: string;
  body: string;
  draft: boolean;
  busy: boolean;
}) {
  const empty = body === '';
  return (
    <figure
      aria-label="Message preview"
      className="mx-auto w-full max-w-[17.5rem] rounded-[2.25rem] border-[6px] border-slate-800 bg-background p-3 shadow-xl dark:border-slate-600"
    >
      <div className="bg-border mx-auto mb-3 h-1.5 w-16 rounded-full" aria-hidden="true" />
      <figcaption className="mb-3 grid justify-items-center gap-0.5 border-b pb-3 text-center">
        <span
          aria-hidden="true"
          className="bg-secondary text-secondary-foreground grid size-9 place-items-center rounded-full text-sm font-semibold uppercase"
        >
          {from === '' ? '?' : from.replace(/[^a-z0-9]/gi, '').charAt(0) || '#'}
        </span>
        <span className="max-w-full truncate text-sm font-semibold">
          {from === '' ? 'Sender' : from}
        </span>
        <span className="text-muted-foreground max-w-full truncate text-xs">
          to {to === '' ? 'no recipient yet' : to}
        </span>
      </figcaption>
      <div className="grid min-h-40 content-start gap-2 pb-2">
        {empty ? (
          <p className="text-muted-foreground px-2 pt-6 text-center text-xs">
            Your message appears here as you fill in the form.
          </p>
        ) : (
          <div
            className={cn(
              'bg-primary text-primary-foreground max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap transition-opacity',
              (draft || busy) && 'opacity-60',
            )}
          >
            {body}
          </div>
        )}
        {draft && !empty ? (
          <span className="text-muted-foreground text-[11px]">
            Template text. The final message appears once the preview is ready.
          </span>
        ) : null}
      </div>
    </figure>
  );
}
