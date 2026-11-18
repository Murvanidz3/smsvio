import Link from 'next/link';

import { cn } from '@/lib/utils';

const base =
  'block rounded-full px-3 py-2 text-[15px] leading-snug font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

export function NavLink({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        base,
        current ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

export function NavAnchor({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className={cn(base, 'text-muted-foreground hover:text-foreground')}>
      {label}
    </a>
  );
}
