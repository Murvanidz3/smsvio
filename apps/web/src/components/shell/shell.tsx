'use client';

import { roleAllows, type SessionResponse } from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';

import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

function subscribeSidebar(onChange: () => void): () => void {
  window.addEventListener('smsvio-sidebar', onChange);
  return () => {
    window.removeEventListener('smsvio-sidebar', onChange);
  };
}

function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem('smsvio.sidebar') === 'collapsed';
}

const NAV = [
  { href: '/dashboard', label: 'Overview', group: 'Main' },
  { href: '/dashboard/templates', label: 'Templates', group: 'Main' },
  { href: '/dashboard/contacts', label: 'Contacts', group: 'Main' },
  { href: '/dashboard/users', label: 'Users', group: 'Account' },
  { href: '/dashboard/settings', label: 'Settings', group: 'Account' },
  { href: '/dashboard/tools/number-lookup', label: 'Number lookup', group: 'Tools' },
] as const;

const GROUPS = ['Main', 'Account', 'Tools'] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      router.replace('/signin');
    }
  }, [router, session.error]);

  async function signOut() {
    await accountApi.signOut();
    queryClient.clear();
    router.push('/signin');
    router.refresh();
  }

  const data = session.data;
  const crumb =
    NAV.filter((item) => isCurrent(pathname, item.href)).sort(
      (left, right) => right.href.length - left.href.length,
    )[0]?.label ?? 'Dashboard';

  return (
    <div className="flex min-h-dvh">
      <aside
        className={`${collapsed ? 'md:w-16' : 'md:w-60'} border-sidebar-border bg-sidebar text-sidebar-foreground hidden shrink-0 border-r md:flex md:flex-col`}
      >
        <div className="flex h-16 items-center px-4">
          <Link href="/dashboard" aria-label="SMSVIO home">
            <Logo className={collapsed ? '[&_span:last-child]:hidden' : undefined} />
          </Link>
        </div>
        <Nav pathname={pathname} />
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground m-3 rounded-md px-2 py-1 text-left text-xs"
          onClick={() => {
            window.localStorage.setItem('smsvio.sidebar', collapsed ? 'open' : 'collapsed');
            window.dispatchEvent(new Event('smsvio-sidebar'));
          }}
        >
          {collapsed ? '»' : 'Collapse'}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b px-4">
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
          <p className="text-sm font-medium">{crumb}</p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8"
              aria-label="Search"
              onClick={() => {
                setPaletteOpen(true);
              }}
            >
              <Search data-icon="inline-start" aria-hidden />
              <span className="hidden sm:inline">Search</span>
              <kbd className="text-muted-foreground hidden text-xs sm:inline">Ctrl K</kbd>
            </Button>
            {data?.organization === null || data?.organization === undefined ? null : (
              <OrgSwitcher session={data} />
            )}
            {data?.organization === null || data?.organization === undefined ? null : (
              <span className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
                {data.organization.role}
              </span>
            )}
            <ThemeToggle />
            <Button type="button" variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>
        {data?.organization?.status === 'PENDING_VERIFICATION' ? (
          <p className="bg-accent text-accent-foreground px-4 py-2 text-sm">
            This organization is waiting for business verification.{' '}
            <Link
              className="font-semibold underline-offset-4 hover:underline"
              href="/dashboard/settings?tab=business"
            >
              Add business details
            </Link>
          </p>
        ) : null}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          {session.isPending ? <p className="text-muted-foreground text-sm">Loading…</p> : children}
        </main>
      </div>
      {menuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
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
            <div
              className="mt-6"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              <Nav pathname={pathname} />
            </div>
          </div>
        </div>
      ) : null}
      {paletteOpen ? (
        <Palette
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Nav({ pathname }: { pathname: string }) {
  return (
    <nav className="grid gap-4 px-3" aria-label="Dashboard">
      {GROUPS.map((group) => (
        <div key={group} className="grid gap-1">
          <p className="text-muted-foreground px-3 text-xs font-semibold tracking-wide">{group}</p>
          {NAV.filter((item) => item.group === group).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${isCurrent(pathname, item.href) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent'}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="grid gap-1">
        <p className="text-muted-foreground px-3 text-xs font-semibold tracking-wide">Help</p>
        <a
          className="hover:bg-sidebar-accent rounded-lg px-3 py-2 text-sm font-medium"
          href="mailto:support@smsvio.com"
        >
          Support
        </a>
      </div>
    </nav>
  );
}

function OrgSwitcher({ session }: { session: SessionResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  if (session.memberships.length < 2 || session.organization === null) {
    return (
      <span className="hidden text-sm font-medium sm:inline">{session.organization?.name}</span>
    );
  }
  return (
    <label className="text-sm">
      <span className="sr-only">Organization</span>
      <select
        className="border-input bg-background h-8 rounded-lg border px-2"
        value={session.organization.id}
        onChange={(event) => {
          void accountApi.switchOrganization(event.target.value).then(async () => {
            await queryClient.invalidateQueries({ queryKey: ['session'] });
            router.refresh();
          });
        }}
      >
        {session.memberships.map((membership) => (
          <option key={membership.organizationId} value={membership.organizationId}>
            {membership.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const items = NAV.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start bg-black/40 px-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-popover text-popover-foreground w-full max-w-md rounded-xl border p-2 shadow-xl"
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          autoFocus
          placeholder="Jump to a page"
          className="h-10 w-full bg-transparent px-3 text-sm outline-none"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose();
            }
            if (event.key === 'Enter' && items[0] !== undefined) {
              router.push(items[0].href);
              onClose();
            }
          }}
        />
        <ul className="grid">
          {items.map((item) => (
            <li key={item.href}>
              <button
                type="button"
                className="hover:bg-accent w-full rounded-lg px-3 py-2 text-left text-sm"
                onClick={() => {
                  router.push(item.href);
                  onClose();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function useCanMessage(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const role = session.data?.organization?.role;
  return role !== undefined && roleAllows(role, 'messaging');
}

export function useCanManage(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const role = session.data?.organization?.role;
  return role !== undefined && roleAllows(role, 'manage');
}

export function useIsOwner(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  return session.data?.organization?.role === 'OWNER';
}
