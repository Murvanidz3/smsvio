import { cn } from 'cn';

import type { MessageDetail } from '@/lib/messages';

function tone(status: string): string {
  if (status === 'delivered') {
    return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300';
  }
  if (['failed', 'undelivered', 'rejected', 'blocked'].includes(status)) {
    return 'bg-rose-500/15 text-rose-800 dark:text-rose-300';
  }
  return 'bg-muted text-muted-foreground';
}

export function Activity({ items, live }: { items: MessageDetail[]; live: boolean }) {
  return (
    <aside className="bg-card rounded-2xl border p-4 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">Activity</h2>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              live ? 'animate-pulse bg-emerald-500' : 'bg-amber-500',
            )}
          />
          {live ? 'Live updates' : 'Live updates unavailable. Refreshing every few seconds.'}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Messages you send from this page show up here.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="bg-background rounded-xl border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p
                  className={cn(
                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                    tone(item.status),
                  )}
                >
                  {item.status}
                </p>
                <span className="text-muted-foreground truncate tabular-nums">{item.to}</span>
              </div>
              <ol className="mt-3 grid gap-1.5 border-l pl-3">
                {item.events.map((event) => (
                  <li key={`${event.at}-${event.status}`} className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium capitalize">{event.status}</span>
                    {event.detail === null ? '' : ` · ${event.detail}`}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
