import { BatteryFull, ChevronLeft, Mic, Plus, Signal, Wifi } from 'lucide-react';

import { cn } from 'cn';

const SIDE_BUTTON =
  'absolute w-[3px] rounded-sm bg-gradient-to-b from-zinc-300 via-zinc-500 to-zinc-400 dark:from-zinc-600 dark:via-zinc-500 dark:to-zinc-700';

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
  const initial = from === '' ? '?' : from.replace(/[^a-z0-9]/gi, '').charAt(0) || '#';
  return (
    <figure aria-label="Message preview" className="relative mx-auto my-1 w-full max-w-[18.75rem]">
      <span aria-hidden="true" className={cn(SIDE_BUTTON, '-left-[3px] top-[5.5rem] h-6')} />
      <span aria-hidden="true" className={cn(SIDE_BUTTON, '-left-[3px] top-[8.25rem] h-11')} />
      <span aria-hidden="true" className={cn(SIDE_BUTTON, '-left-[3px] top-[10.5rem] h-11')} />
      <span aria-hidden="true" className={cn(SIDE_BUTTON, '-right-[3px] top-[9rem] h-16')} />
      <div className="rounded-[3rem] bg-gradient-to-br from-zinc-200 via-zinc-400 to-zinc-300 p-[3px] shadow-[0_28px_50px_-18px_rgb(17_17_20/55%),0_12px_20px_-12px_rgb(17_17_20/40%)] dark:from-zinc-500 dark:via-zinc-700 dark:to-zinc-600 dark:shadow-[0_28px_50px_-18px_rgb(0_0_0/80%)]">
        <div className="rounded-[2.8rem] bg-[#0b0b0e] p-[7px] ring-1 ring-black/60">
          <div className="bg-card text-card-foreground relative flex aspect-[9/18.5] flex-col overflow-hidden rounded-[2.25rem]">
            <div
              aria-hidden="true"
              className="absolute top-2.5 left-1/2 z-10 h-[1.65rem] w-24 -translate-x-1/2 rounded-full bg-black"
            />
            <div
              aria-hidden="true"
              className="flex h-12 shrink-0 items-center justify-between px-7 pt-2 text-[13px] font-semibold tabular-nums"
            >
              <span>9:41</span>
              <span className="flex items-center gap-1">
                <Signal className="size-3.5" strokeWidth={2.5} />
                <Wifi className="size-3.5" strokeWidth={2.5} />
                <BatteryFull className="size-5" strokeWidth={2} />
              </span>
            </div>
            <div className="bg-muted/60 grid shrink-0 grid-cols-[2rem_1fr_2rem] items-start border-b px-3 pt-1 pb-2">
              <ChevronLeft
                aria-hidden="true"
                className="mt-1 size-5 text-sky-500"
                strokeWidth={2.5}
              />
              <div className="grid min-w-0 justify-items-center gap-0.5 text-center">
                <span
                  aria-hidden="true"
                  className="bg-lavender text-lavender-foreground grid size-9 place-items-center rounded-full text-sm font-bold uppercase"
                >
                  {initial}
                </span>
                <span className="max-w-full truncate text-[13px] leading-tight font-bold">
                  {from === '' ? 'Sender' : from}
                </span>
                <span className="text-muted-foreground max-w-full truncate text-[10px] leading-tight">
                  Text Message &middot; SMS
                </span>
              </div>
              <span aria-hidden="true" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-3 pb-2">
              <p className="text-muted-foreground text-center text-[10px] leading-tight font-medium">
                Today 9:41
                <span className="block truncate">To {to === '' ? 'no recipient yet' : to}</span>
              </p>
              {empty ? (
                <p className="text-muted-foreground px-3 pt-10 text-center text-xs">
                  Your message appears here as you fill in the form.
                </p>
              ) : (
                <div className="mt-2 flex">
                  <div
                    className={cn(
                      'relative max-w-[82%] rounded-[1.15rem] bg-[#e9e9eb] px-3.5 py-2 text-[13px] leading-snug break-words whitespace-pre-wrap text-[#111114] transition-opacity dark:bg-[#2b2b31] dark:text-[#f4f4f6]',
                      'before:absolute before:bottom-0 before:-left-[7px] before:h-4 before:w-4 before:rounded-br-[1rem] before:bg-[#e9e9eb] before:content-[""] dark:before:bg-[#2b2b31]',
                      'after:bg-card after:absolute after:bottom-0 after:-left-[10px] after:h-4 after:w-2.5 after:rounded-br-[0.6rem] after:content-[""]',
                      (draft || busy) && 'opacity-60',
                    )}
                  >
                    {body}
                  </div>
                </div>
              )}
              {draft && !empty ? (
                <span className="text-muted-foreground px-1 text-[10px]">
                  Template text. The final message appears once the preview is ready.
                </span>
              ) : null}
            </div>
            <div aria-hidden="true" className="flex shrink-0 items-center gap-2 px-3 pt-1">
              <span className="bg-muted text-muted-foreground grid size-7 place-items-center rounded-full">
                <Plus className="size-4" strokeWidth={2.5} />
              </span>
              <span className="text-muted-foreground flex h-8 flex-1 items-center justify-between rounded-full border px-3 text-xs">
                Text Message
                <Mic className="size-3.5" />
              </span>
            </div>
            <div aria-hidden="true" className="flex h-6 shrink-0 items-end justify-center pb-2">
              <span className="bg-foreground h-1 w-28 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
