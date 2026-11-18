'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, type SubmitEvent, useState } from 'react';

import { flag } from '@/components/catalog/table-tools';
import { useCanBilling } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button, buttonVariants } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';
import { insightApi, type Overview } from '@/lib/billing';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const;

export default function OverviewPage() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const user = session.data?.user;
  const organization = session.data?.organization;

  function createOrganization(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void accountApi
      .createOrganization(name)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ['session'] });
      })
      .catch((error: unknown) => {
        toast(error instanceof ApiError ? error.message : 'Could not create the organization.');
      });
  }

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome{user === undefined ? '' : `, ${user.name}`}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {organization === null || organization === undefined
            ? 'Name your organization to start working with a team.'
            : `${organization.name} · ${organization.role}`}
        </p>
      </div>
      {organization === null && user !== undefined ? (
        <form className="grid max-w-sm gap-3" onSubmit={createOrganization}>
          <label className="grid gap-1.5 text-sm font-medium">
            Organization
            <input
              className="border-input h-10 rounded-lg border px-3 font-normal"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <Button type="submit">Create organization</Button>
        </form>
      ) : null}
      {organization === null || organization === undefined ? null : <Dashboard />}
    </section>
  );
}

function Dashboard() {
  const canBill = useCanBilling();
  const [range, setRange] = useState<(typeof RANGES)[number]['id'] | 'custom'>('7');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = range === 'custom' ? `?range=custom&from=${from}&to=${to}` : `?range=${range}`;
  const overview = useQuery({
    queryKey: ['overview', query],
    queryFn: () => insightApi.overview(query),
    enabled: range !== 'custom' || (from !== '' && to !== ''),
  });
  const data = overview.data;

  return (
    <div className="grid gap-6">
      {data?.verification === 'PENDING_VERIFICATION' ? (
        <p className="border-border bg-muted/40 rounded-xl border px-4 py-3 text-sm">
          Business verification is not finished.{' '}
          <Link href="/dashboard/compliance" className="font-semibold underline">
            Open compliance
          </Link>
          .
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)]">
        <div className="bg-hero text-hero-foreground grid gap-6 rounded-3xl p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-medium text-white/60">Balance</h2>
            <Link
              href={canBill ? '/dashboard/billing' : '/dashboard'}
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
            >
              {canBill ? 'Manage' : 'Available'}
            </Link>
          </div>
          <div className="flex items-end justify-between gap-4">
            <p className="text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
              {data?.balance.available.display ?? '—'}
              <span className="ml-2 text-lg font-medium text-white/60">USD</span>
            </p>
            <Sparkline days={data?.days ?? []} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/send"
              className={buttonVariants({ variant: 'light', size: 'lg' })}
            >
              Send a message
            </Link>
            <Link
              href="/dashboard/messages"
              className={buttonVariants({ variant: 'outline-light', size: 'lg' })}
            >
              View messages
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card title="Templates" href="/dashboard/templates" action="View all" tone="bg-lavender">
            <p className="text-3xl font-bold tracking-tight">{data?.templates ?? '—'}</p>
            <p className="text-muted-foreground text-sm">Create a new template from the list.</p>
          </Card>
          <Card title="Total contacts" href="/dashboard/contacts" action="View all" tone="bg-mint">
            <p className="text-3xl font-bold tracking-tight">{data?.contacts ?? '—'}</p>
          </Card>
          <div className="bg-peach grid content-start gap-2 rounded-3xl p-5">
            <h2 className="text-muted-foreground text-sm font-medium">Deliverability</h2>
            <p className="text-3xl font-bold tracking-tight">
              {data?.deliverability === null || data === undefined
                ? '—'
                : `${String(Math.round(data.deliverability * 100))}%`}
            </p>
            <p className="text-muted-foreground text-sm">
              Delivered divided by messages with a final status.
            </p>
          </div>
        </div>
      </div>
      <div className="bg-card grid gap-5 rounded-2xl border p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Messages</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              This page counts your messages when it opens. Stored daily statistics refresh every 15
              minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGES.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={range === item.id ? 'default' : 'outline'}
                onClick={() => {
                  setRange(item.id);
                }}
              >
                {item.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={range === 'custom' ? 'default' : 'outline'}
              onClick={() => {
                setRange('custom');
              }}
            >
              Custom
            </Button>
          </div>
        </div>
        {range === 'custom' ? (
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-sm">
              From
              <input
                type="date"
                className="border-input h-10 rounded-lg border px-3"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm">
              To
              <input
                type="date"
                className="border-input h-10 rounded-lg border px-3"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                }}
              />
            </label>
          </div>
        ) : null}
        {overview.isError ? (
          <p className="text-sm">
            {overview.error instanceof ApiError
              ? overview.error.message
              : 'Those dates could not be loaded.'}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Sent" value={String(data?.totals.sent ?? 0)} tone="bg-lavender" />
          <Stat label="Delivered" value={String(data?.totals.delivered ?? 0)} tone="bg-mint" />
          <Stat label="Failed" value={String(data?.totals.failed ?? 0)} tone="bg-peach" />
          <Stat
            label="Spend"
            value={`${data?.totals.spend.display ?? '0.00'} USD`}
            tone="bg-teal"
          />
        </div>{' '}
        <UsageChart days={data?.days ?? []} />
      </div>
      <div className="bg-card rounded-2xl border p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">Recent contacts</h2>
          <Link
            href="/dashboard/contacts"
            className="hover:bg-muted rounded-full border px-3 py-1 text-xs font-medium"
          >
            View all contacts
          </Link>
        </div>
        {data === undefined || data.recentContacts.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">No contacts yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">ID</th>
                <th className="py-2 font-medium">Country</th>
                <th className="py-2 font-medium">Phone</th>
                <th className="py-2 font-medium">Opt-out</th>
              </tr>
            </thead>
            <tbody>
              {data.recentContacts.map((contact) => (
                <tr key={contact.id} className="border-border border-t">
                  <td className="py-3 font-mono text-xs">{contact.id.slice(0, 8)}</td>
                  <td className="py-3 font-medium">
                    {flag(contact.country)} {contact.country} +{contact.dialCode}
                  </td>
                  <td className="py-3 font-mono text-xs">{contact.phone}</td>
                  <td className="py-3">{contact.optedOut ? 'Opted out' : 'Active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  href,
  action,
  tone,
  children,
}: {
  title: string;
  href: string;
  action: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className={`${tone} grid content-start gap-2 rounded-3xl p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-sm font-medium">{title}</h2>
        <Link
          href={href}
          className="bg-card/70 hover:bg-card rounded-full px-2.5 py-0.5 text-xs font-medium"
        >
          {action}
        </Link>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`${tone} rounded-2xl p-4`}>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function Sparkline({ days }: { days: Overview['days'] }) {
  if (days.length < 2) {
    return null;
  }
  const peak = Math.max(1, ...days.map((day) => day.sent));
  const step = 120 / (days.length - 1);
  const points = days
    .map(
      (day, index) =>
        `${String(Math.round(index * step))},${String(Math.round(34 - (day.sent / peak) * 30))}`,
    )
    .join(' ');
  return (
    <svg
      role="img"
      aria-label="Daily sent messages trend"
      viewBox="0 0 120 38"
      className="h-10 w-28 shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-positive"
      />
    </svg>
  );
}
function UsageChart({ days }: { days: Overview['days'] }) {
  const peak = Math.max(1, ...days.map((day) => day.sent));
  if (days.length === 0) {
    return null;
  }
  return (
    <div
      role="img"
      aria-label="Daily sent messages"
      className="flex h-40 items-end justify-between gap-2"
    >
      {days.map((day) => (
        <div
          key={day.day}
          title={`${day.day}: ${String(day.sent)} sent`}
          style={{ height: `${String(Math.max(4, Math.round((day.sent / peak) * 100)))}%` }}
          className="bg-primary min-w-1.5 max-w-5 flex-1 rounded-full"
        />
      ))}
    </div>
  );
}
