'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Building2,
  ClipboardList,
  Gauge,
  Menu,
  Route,
  ScrollText,
  Search,
  Server,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';

import { Logo } from '@/components/brand/logo';
import { MenuPin, useMenuPin } from '@/components/shell/menu-pin';
import { RailLink } from '@/components/shell/rail';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/admin';
import { accountApi } from '@/lib/api';

const LINKS = [
  { href: '/admin/operations', label: 'Operations', icon: Gauge, badge: false },
  { href: '/admin/statistics', label: 'Statistics', icon: BarChart3, badge: false },
  { href: '/admin', label: 'Organizations', icon: Building2, badge: false },
  { href: '/admin/providers', label: 'Providers', icon: Server, badge: false },
  { href: '/admin/routes', label: 'Routes', icon: Route, badge: false },
  { href: '/admin/rates', label: 'Rates', icon: BadgeDollarSign, badge: false },
  { href: '/admin/reviews', label: 'Reviews', icon: ClipboardList, badge: true },
  { href: '/admin/messages', label: 'Messages', icon: Search, badge: false },
  { href: '/admin/health', label: 'Health', icon: Activity, badge: false },
  { href: '/admin/margin', label: 'Margin', icon: BadgeDollarSign, badge: false },
  { href: '/admin/audit', label: 'Audit', icon: ScrollText, badge: false },
] as const;

function current(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pinned, togglePin } = useMenuPin();
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const reviews = useQuery({
    queryKey: ['admin-reviews'],
    queryFn: () => adminApi.reviews(),
    enabled: session.data?.user.isPlatformAdmin === true,
  });
  const pending =
    (reviews.data?.verification.length ?? 0) +
    (reviews.data?.useCases.length ?? 0) +
    (reviews.data?.senders.length ?? 0) +
    (reviews.data?.templates.length ?? 0);
  if (session.data !== undefined && !session.data.user.isPlatformAdmin) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-bold">That page does not exist.</h1>
      </main>
    );
  }
  return (
    <div className="bg-background min-h-dvh">
      <header className="vio-topbar border-sidebar-border bg-sidebar flex items-center gap-3 border-b px-4 sm:px-[18px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open menu"
          onClick={() => {
            setMenuOpen(true);
          }}
        >
          <Menu aria-hidden />
        </Button>
        <Link href="/dashboard" aria-label="SMSVIO home">
          <Logo />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/dashboard" className="text-sm font-semibold">
            Dashboard
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <aside
        className="vio-side border-sidebar-border bg-sidebar text-sidebar-foreground border-r"
        data-pinned={pinned ? 'true' : 'false'}
      >
        <nav className="grid min-h-0 flex-1 gap-0.5 overflow-y-auto" aria-label="Admin">
          {LINKS.map((link) => (
            <RailLink
              key={link.href}
              href={link.href}
              label={link.label}
              icon={link.icon}
              current={current(pathname, link.href)}
              badge={link.badge ? pending : undefined}
            />
          ))}
        </nav>
        <MenuPin pinned={pinned} onToggle={togglePin} />
      </aside>
      <div className="vio-canvas flex min-w-0 flex-col">
        <nav className="flex gap-1 overflow-x-auto px-4 pt-3 pb-3 md:hidden" aria-label="Admin">
          {LINKS.map((link) => (
            <RailLink
              key={link.href}
              href={link.href}
              label={link.label}
              icon={link.icon}
              showLabel
              current={current(pathname, link.href)}
              badge={link.badge ? pending : undefined}
            />
          ))}
        </nav>
        <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-2 sm:px-7">{children}</main>
      </div>
      {menuOpen ? (
        <div
          className="fixed inset-0 z-[60] bg-black/40 md:hidden"
          onClick={() => {
            setMenuOpen(false);
          }}
        >
          <div
            className="bg-sidebar text-sidebar-foreground h-full w-72 p-4"
            onClick={(event) => {
              event.stopPropagation();
            }}
            role="dialog"
            aria-label="Menu"
          >
            <Logo />
            <nav
              className="mt-6 grid gap-1"
              aria-label="Admin"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {LINKS.map((link) => (
                <RailLink
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  icon={link.icon}
                  showLabel
                  current={current(pathname, link.href)}
                  badge={link.badge ? pending : undefined}
                />
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
