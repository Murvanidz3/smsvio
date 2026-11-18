import { CircleAlert, CircleCheck, LoaderCircle, SendHorizontal } from 'lucide-react';
import { cn } from 'cn';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';

export function Hero({
  cost,
  caption,
  segments,
  blocker,
  canSend,
  disabled,
  busy,
  outcome,
  onSend,
}: {
  cost: string | undefined;
  caption: string;
  segments: number;
  blocker: string;
  canSend: boolean;
  disabled: boolean;
  busy: boolean;
  outcome: { ok: boolean; text: string } | null;
  onSend: () => void;
}) {
  const filled = Math.min(segments, 10);
  return (
    <section className="bg-hero text-hero-foreground grid gap-6 rounded-3xl p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_15rem] md:items-end">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/60">Estimated cost</p>
        <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
          {cost ?? '\u2014'}
          <span className="ml-2 text-lg font-medium text-white/60">USD</span>
        </p>
        <p className="mt-2 text-sm text-white/70">{caption}</p>
        <div className="mt-5 flex items-end gap-4">
          <div className="flex h-8 items-end gap-1.5" aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <span
                key={index}
                style={{ height: `${String(30 + index * 7)}%` }}
                className={cn('w-2.5 rounded-full', index < filled ? 'bg-positive' : 'bg-white/15')}
              />
            ))}
          </div>
          <p className="text-xs text-white/60">
            {segments === 0 ? 'No segments yet' : `${String(segments)} of 10 segments`}
          </p>
        </div>
      </div>
      <div className="grid gap-3">
        <span
          title={canSend ? undefined : 'Only an owner, admin, or developer can send.'}
          className="grid"
        >
          <Button
            type="button"
            variant="light"
            size="lg"
            disabled={disabled}
            aria-busy={busy}
            className="h-12 w-full text-base font-semibold"
            onClick={onSend}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <SendHorizontal aria-hidden="true" />
            )}
            {busy ? 'Sending\u2026' : 'Send'}
          </Button>
        </span>
        <Link
          href="/dashboard/messages"
          className={cn(buttonVariants({ variant: 'outline-light', size: 'lg' }), 'h-12 w-full')}
        >
          View messages
        </Link>
      </div>
      {blocker === '' && outcome === null ? null : (
        <div className="grid gap-2 md:col-span-2">
          {outcome === null ? null : (
            <div
              aria-live="polite"
              className="flex items-start gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm"
            >
              {outcome.ok ? (
                <CircleCheck aria-hidden="true" className="text-positive mt-0.5 size-4 shrink-0" />
              ) : (
                <CircleAlert aria-hidden="true" className="text-expense mt-0.5 size-4 shrink-0" />
              )}
              <span>{outcome.text}</span>
            </div>
          )}
          {blocker === '' ? null : <p className="text-sm text-white/60">{blocker}</p>}
        </div>
      )}
    </section>
  );
}
