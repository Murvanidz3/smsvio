import { Check, Clock, X } from 'lucide-react';
import { cn } from 'cn';

import type { MessageDetail } from '@/lib/messages';

function kind(status: string): 'ok' | 'bad' | 'wait' {
  if (status === 'delivered') {
    return 'ok';
  }
  if (['failed', 'undelivered', 'rejected', 'blocked'].includes(status)) {
    return 'bad';
  }
  return 'wait';
}

const TONE = {
  ok: 'bg-mint text-mint-foreground',
  bad: 'bg-peach text-peach-foreground',
  wait: 'bg-lavender text-lavender-foreground',
} as const;

export function Activity({ items, live }: { items: MessageDetail[]; live: boolean }) {
  return (
    <aside className="bg-card rounded-2xl border p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight">Activity</h2>
        <span
          className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
          title={live ? undefined : 'Live updates unavailable. Refreshing every few seconds.'}
        >
          <span
            aria-hidden="true"
            className={cn('size-2 rounded-full', live ? 'bg-positive animate-pulse' : 'bg-expense')}
          />
          {live ? 'Live updates' : 'Refreshing'}
        </span>
      </div>
      {live ? null : (
        <p className="text-muted-foreground mt-2 text-xs">
          Live updates unavailable. Refreshing every few seconds.
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          Messages you send from this page show up here.
        </p>
      ) : (
        <ul className="mt-4 grid gap-1 divide-y">
          {items.map((item) => {
            const state = kind(item.status);
            const Icon = state === 'ok' ? Check : state === 'bad' ? X : Clock;
            return (
              <li key={item.id} className="grid gap-3 py-3 text-sm first:pt-0">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-xl',
                      TONE[state],
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-bold tabular-nums">{item.to}</span>
                    <p className="text-muted-foreground text-xs capitalize">{item.status}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-bold tabular-nums',
                      state === 'bad' ? 'text-muted-foreground line-through' : 'text-expense',
                    )}
                  >
                    {`\u2212${item.price.display}`}
                  </span>
                </div>
                <ol className="text-muted-foreground ml-[3.25rem] grid gap-1 text-xs">
                  {item.events.map((event) => (
                    <li key={`${event.at}-${event.status}`}>
                      <span className="text-foreground font-medium capitalize">{event.status}</span>
                      {event.detail === null ? '' : ` \u00b7 ${event.detail}`}
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
