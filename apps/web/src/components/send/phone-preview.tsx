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
      className="bg-muted mx-auto w-full max-w-[18rem] rounded-[2rem] p-3"
    >
      <figcaption className="bg-card mb-3 grid justify-items-center gap-0.5 rounded-3xl px-3 py-3 text-center">
        <span
          aria-hidden="true"
          className="bg-lavender text-lavender-foreground grid size-9 place-items-center rounded-full text-sm font-bold uppercase"
        >
          {from === '' ? '?' : from.replace(/[^a-z0-9]/gi, '').charAt(0) || '#'}
        </span>
        <span className="max-w-full truncate text-sm font-bold">
          {from === '' ? 'Sender' : from}
        </span>
        <span className="text-muted-foreground max-w-full truncate text-xs">
          to {to === '' ? 'no recipient yet' : to}
        </span>
      </figcaption>
      <div className="grid min-h-44 content-start gap-2 px-1 pb-2">
        {empty ? (
          <p className="text-muted-foreground px-2 pt-8 text-center text-xs">
            Your message appears here as you fill in the form.
          </p>
        ) : (
          <div
            className={cn(
              'bg-hero text-hero-foreground max-w-[90%] rounded-3xl rounded-tl-md px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap transition-opacity',
              (draft || busy) && 'opacity-60',
            )}
          >
            {body}
          </div>
        )}
        {draft && !empty ? (
          <span className="text-muted-foreground px-1 text-[11px]">
            Template text. The final message appears once the preview is ready.
          </span>
        ) : null}
      </div>
    </figure>
  );
}
