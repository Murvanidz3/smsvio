import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export function RailLink({
  href,
  label,
  current,
  icon: Icon,
  showLabel = false,
}: {
  href: string;
  label: string;
  current: boolean;
  icon: LucideIcon;
  showLabel?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      title={label}
      className={cn(
        'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-3 rounded-[10px] text-sm font-medium whitespace-nowrap',
        showLabel ? 'px-3 py-2' : 'min-h-11 px-[13px]',
        current && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold',
      )}
    >
      <Icon className="size-[22px] shrink-0" strokeWidth={1.7} aria-hidden />
      <span className={showLabel ? undefined : 'vio-lbl'}>{label}</span>
    </Link>
  );
}
