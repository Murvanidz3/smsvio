'use client';

import { roleAllows, type SessionResponse } from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Contact,
  FileText,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  ScanSearch,
  Search,
  Send,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { Logo } from '@/components/brand/logo';
import { MenuPin, useMenuPin } from '@/components/shell/menu-pin';
import { RailLink } from '@/components/shell/rail';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

const GROUPS = ['Main', 'Development', 'Account', 'Tools'] as const;

const NAV: readonly {
  href: string;
  label: string;
  group: (typeof GROUPS)[number];
  icon: LucideIcon;
}[] = [
  { href: '/dashboard', label: 'Overview', group: 'Main', icon: LayoutDashboard },
  { href: '/dashboard/templates', label: 'Templates', group: 'Main', icon: FileText },
  { href: '/dashboard/send', label: 'Send', group: 'Main', icon: Send },
  { href: '/dashboard/contacts', label: 'Contacts', group: 'Main', icon: Contact },
  { href: '/dashboard/messages', label: 'Messages', group: 'Development', icon: MessagesSquare },
  { href: '/dashboard/senders', label: 'Senders', group: 'Main', icon: AtSign },
  { href: '/dashboard/users', label: 'Users', group: 'Account', icon: Users },
  { href: '/dashboard/settings', label: 'Settings', group: 'Account', icon: Settings },
  {
    href: '/dashboard/tools/number-lookup',
    label: 'Number lookup',
    group: 'Tools',
    icon: ScanSearch,
  },
];

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
  const [clock, setClock] = useState('');
  const { pinned, togglePin } = useMenuPin();

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

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
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground hidden font-medium tabular-nums sm:inline">
            {clock}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-[38px] rounded-[9px] px-3 shadow-sm"
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
          {data?.user.isPlatformAdmin === true ? (
            <Link href="/admin" className="text-sm font-medium">
              Admin
            </Link>
          ) : null}
          <ThemeToggle />
          <Button
            type="button"
            variant="outline"
            className="h-[38px] rounded-[9px] px-3 shadow-sm"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </header>
      <aside
        className="vio-side border-sidebar-border bg-sidebar text-sidebar-foreground border-r"
        data-pinned={pinned ? 'true' : 'false'}
      >
        <Nav pathname={pathname} />
        <MenuPin pinned={pinned} onToggle={togglePin} />
      </aside>
      <div className="vio-canvas flex min-w-0 flex-col">
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
        <main className="min-w-0 flex-1 px-4 pt-6 pb-6 sm:px-7">
          {session.isPending ? <p className="text-muted-foreground text-sm">Loading…</p> : children}
        </main>
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
            <div
              className="mt-6"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              <Nav pathname={pathname} showLabels />
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

function Nav({ pathname, showLabels = false }: { pathname: string; showLabels?: boolean }) {
  return (
    <nav
      className={showLabels ? 'grid gap-4' : 'grid min-h-0 flex-1 gap-1 overflow-y-auto'}
      aria-label="Dashboard"
    >
      {GROUPS.map((group) => (
        <div key={group} className={showLabels ? 'grid gap-1' : 'grid gap-0.5'}>
          {showLabels ? (
            <p className="text-muted-foreground px-3 text-xs font-semibold tracking-wide">
              {group}
            </p>
          ) : (
            <p className="vio-group text-muted-foreground">{group}</p>
          )}
          {NAV.filter((item) => item.group === group).map((item) => (
            <RailLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              showLabel={showLabels}
              current={isCurrent(pathname, item.href)}
            />
          ))}
        </div>
      ))}
      <div className={showLabels ? 'grid gap-1' : 'grid gap-0.5'}>
        {showLabels ? (
          <p className="text-muted-foreground px-3 text-xs font-semibold tracking-wide">Help</p>
        ) : (
          <p className="vio-group text-muted-foreground">Help</p>
        )}
        <a
          className="hover:bg-sidebar-accent flex min-h-11 w-full items-center gap-3 rounded-[10px] px-[13px] text-sm font-medium whitespace-nowrap"
          href="mailto:support@smsvio.com"
          title="Support"
        >
          <span className="grid size-[22px] shrink-0 place-items-center" aria-hidden>
            ?
          </span>
          <span className={showLabels ? undefined : 'vio-lbl'}>Support</span>
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

export function useCanCompliance(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const role = session.data?.organization?.role;
  return role !== undefined && roleAllows(role, 'compliance');
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
