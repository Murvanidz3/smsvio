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
        'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center rounded-[10px] font-medium',
        showLabel ? 'gap-3 px-3 py-2 text-sm' : 'size-11 justify-center',
        current && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.7} aria-hidden />
      <span className={showLabel ? undefined : 'sr-only'}>{label}</span>
    </Link>
  );
}
