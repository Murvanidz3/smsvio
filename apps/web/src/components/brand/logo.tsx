import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-brand-mark" />
      <path
        d="M9.5 8h13A3.5 3.5 0 0 1 26 11.5v7a3.5 3.5 0 0 1-3.5 3.5H15l-5 4v-4h-.5A3.5 3.5 0 0 1 6 18.5v-7A3.5 3.5 0 0 1 9.5 8Z"
        className="fill-brand-glyph"
      />
      <path
        d="m11.75 12.25 4.25 5.5 4.25-5.5"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-brand-mark"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-brand-ink text-lg font-extrabold tracking-tight">
        SMS<span className="text-brand-mark">VIO</span>
      </span>
    </span>
  );
}
