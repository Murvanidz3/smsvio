'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { accountApi } from '@/lib/api';

const LINKS = [
  { href: '/admin', label: 'Organizations' },
  { href: '/admin/providers', label: 'Providers' },
  { href: '/admin/routes', label: 'Routes' },
  { href: '/admin/rates', label: 'Rates' },
] as const;

export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  if (session.data !== undefined && !session.data.user.isPlatformAdmin) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-bold">That page does not exist.</h1>
      </main>
    );
  }
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-4 border-b px-4 py-3">
        <Link href="/dashboard" aria-label="SMSVIO home">
          <Logo />
        </Link>
        <nav className="flex flex-wrap gap-1" aria-label="Admin">
          {LINKS.map((link) => {
            const current =
              link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${current ? 'bg-accent' : 'hover:bg-muted'}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/dashboard" className="text-sm font-medium">
            Dashboard
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6">{children}</main>
    </div>
  );
}
