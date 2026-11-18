'use client';

import {
  roleAllows,
  type Capability,
  type MembershipRole,
  type SessionResponse,
} from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, LogOut, Menu, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { Logo } from '@/components/brand/logo';
import { NavAnchor, NavLink } from '@/components/shell/nav-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

const GROUPS = ['Main', 'Development', 'Account', 'Tools'] as const;

const NAV: readonly {
  href: string;
  label: string;
  group: (typeof GROUPS)[number];
  capability?: Capability;
}[] = [
  { href: '/dashboard', label: 'Overview', group: 'Main' },
  { href: '/dashboard/templates', label: 'Templates', group: 'Main' },
  { href: '/dashboard/send', label: 'Send', group: 'Main' },
  { href: '/dashboard/contacts', label: 'Contacts', group: 'Main' },
  { href: '/dashboard/messages', label: 'Messages', group: 'Development' },
  {
    href: '/dashboard/api-keys',
    label: 'API keys',
    group: 'Development',
    capability: 'developer',
  },
  {
    href: '/dashboard/webhooks',
    label: 'Webhooks',
    group: 'Development',
    capability: 'developer',
  },
  { href: '/docs', label: 'Documentation', group: 'Development' },
  { href: '/dashboard/senders', label: 'Senders', group: 'Main' },
  {
    href: '/dashboard/compliance',
    label: 'Compliance',
    group: 'Main',
    capability: 'compliance',
  },
  { href: '/dashboard/users', label: 'Users', group: 'Account' },
  { href: '/dashboard/settings', label: 'Settings', group: 'Account' },
  {
    href: '/dashboard/billing',
    label: 'Billing',
    group: 'Account',
    capability: 'billing',
  },
  {
    href: '/dashboard/tools/number-lookup',
    label: 'Number lookup',
    group: 'Tools',
  },
  {
    href: '/dashboard/tools/pricing',
    label: 'Pricing',
    group: 'Tools',
  },
];

function visibleNav(role: MembershipRole | undefined) {
  return NAV.filter(
    (item) =>
      item.capability === undefined || (role !== undefined && roleAllows(role, item.capability)),
  );
}

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
  const role = data?.organization?.role;

  return (
    <div className="bg-background min-h-dvh">
      <aside className="ds-side text-sidebar-foreground">
        <Link href="/dashboard" aria-label="SMSVIO home" className="mb-8 inline-flex">
          <Logo />
        </Link>
        <Nav pathname={pathname} role={role} />
        <SideFooter onSignOut={() => void signOut()} />
      </aside>
      <div className="ds-canvas flex min-w-0 flex-col">
        <header className="bg-card/90 sticky top-0 z-30 flex items-center gap-3 rounded-t-[24px] px-4 py-3 backdrop-blur sm:px-8 md:static md:py-6">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => {
              setMenuOpen(true);
            }}
          >
            <Menu aria-hidden />
          </Button>
          <Link href="/dashboard" aria-label="SMSVIO home" className="md:hidden">
            <Logo />
          </Link>
          <button
            type="button"
            aria-label="Search"
            className="bg-muted text-muted-foreground hover:bg-accent focus-visible:ring-ring/40 ml-auto flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-0 text-sm font-medium outline-none focus-visible:ring-3 max-sm:w-10 sm:w-72 sm:justify-start sm:px-4 md:ml-0"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden sm:inline">Search</span>
            <kbd className="text-muted-foreground/80 ml-auto hidden text-xs sm:inline">Ctrl K</kbd>
          </button>
          <div className="flex items-center gap-2 md:ml-auto">
            <span className="text-muted-foreground hidden px-1 text-sm font-medium tabular-nums lg:inline">
              {clock}
            </span>
            {data?.organization === null || data?.organization === undefined ? null : (
              <OrgSwitcher session={data} />
            )}
            {data?.organization === null || data?.organization === undefined ? null : (
              <span className="bg-muted text-foreground hidden h-10 items-center rounded-full px-4 text-xs font-semibold tracking-wide sm:inline-flex">
                {data.organization.role}
              </span>
            )}
            <Link
              href="/dashboard/settings"
              aria-label="Account settings"
              className="bg-muted hover:bg-accent focus-visible:ring-ring/40 hidden size-10 place-items-center rounded-full outline-none focus-visible:ring-3 sm:grid"
            >
              <Settings className="size-4" aria-hidden />
            </Link>
            <a
              href="mailto:support@smsvio.com"
              aria-label="Contact support"
              className="bg-muted hover:bg-accent focus-visible:ring-ring/40 hidden size-10 place-items-center rounded-full outline-none focus-visible:ring-3 sm:grid"
            >
              <LifeBuoy className="size-4" aria-hidden />
            </a>
            {data?.user.isPlatformAdmin === true ? (
              <Link
                href="/admin"
                className="bg-primary text-primary-foreground hidden h-10 items-center rounded-full px-5 text-sm font-medium sm:inline-flex"
              >
                Admin
              </Link>
            ) : null}
          </div>
        </header>
        {data?.organization?.status === 'PENDING_VERIFICATION' ? (
          <p className="bg-peach text-peach-foreground mx-4 mb-2 rounded-2xl px-4 py-3 text-sm sm:mx-8">
            This organization is waiting for business verification.{' '}
            <Link
              className="font-semibold underline-offset-4 hover:underline"
              href="/dashboard/settings?tab=business"
            >
              Add business details
            </Link>
          </p>
        ) : null}
        <main className="min-w-0 flex-1 px-4 pt-2 pb-10 sm:px-8">
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
            className="bg-card text-sidebar-foreground flex h-full w-72 flex-col overflow-y-auto rounded-r-3xl p-5"
            onClick={(event) => {
              event.stopPropagation();
            }}
            role="dialog"
            aria-label="Menu"
          >
            <Logo className="mb-6" />
            <div
              className="flex-1"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              <Nav pathname={pathname} role={role} />
            </div>
            <SideFooter onSignOut={() => void signOut()} />
          </div>
        </div>
      ) : null}
      {paletteOpen ? (
        <Palette
          role={role}
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Nav({ pathname, role }: { pathname: string; role: MembershipRole | undefined }) {
  const items = visibleNav(role);
  return (
    <nav className="grid flex-1 content-start gap-3" aria-label="Dashboard">
      {GROUPS.map((group) => (
        <div key={group} className="grid gap-0.5 border-t pt-3 first:border-t-0 first:pt-0">
          <p className="sr-only">{group}</p>
          {items
            .filter((item) => item.group === group)
            .map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                current={isCurrent(pathname, item.href)}
              />
            ))}
        </div>
      ))}
      <div className="grid gap-0.5 border-t pt-3">
        <p className="sr-only">Help</p>
        <NavAnchor href="mailto:support@smsvio.com" label="Support" />
      </div>
    </nav>
  );
}

function SideFooter({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="mt-6 grid gap-0.5 border-t pt-3">
      <ThemeToggle variant="switch" />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 flex items-center gap-2 rounded-full px-3 py-2 text-left text-[15px] font-medium outline-none focus-visible:ring-3"
        onClick={onSignOut}
      >
        <LogOut className="size-4" aria-hidden />
        Sign out
      </button>
    </div>
  );
}

function OrgSwitcher({ session }: { session: SessionResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  if (session.memberships.length < 2 || session.organization === null) {
    return (
      <span className="bg-muted hidden h-10 items-center rounded-full px-4 text-sm font-medium sm:inline-flex">
        {session.organization?.name}
      </span>
    );
  }
  return (
    <label className="text-sm">
      <span className="sr-only">Organization</span>
      <select
        className="border-input bg-muted h-10 max-w-40 rounded-full border px-4 text-sm font-medium sm:max-w-none"
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

function Palette({ role, onClose }: { role: MembershipRole | undefined; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const items = visibleNav(role).filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start bg-black/40 px-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-popover text-popover-foreground mx-auto w-full max-w-md rounded-3xl border p-3 shadow-xl"
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <input
          autoFocus
          placeholder="Jump to a page"
          className="bg-muted h-11 w-full rounded-full px-4 text-sm outline-none"
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
        <ul className="mt-2 grid">
          {items.map((item) => (
            <li key={item.href}>
              <button
                type="button"
                className="hover:bg-muted w-full rounded-full px-4 py-2 text-left text-sm font-medium"
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
export function useCanBilling(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const role = session.data?.organization?.role;
  return role !== undefined && roleAllows(role, 'billing');
}

export function useCanDeveloper(): boolean {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const role = session.data?.organization?.role;
  return role !== undefined && roleAllows(role, 'developer');
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
