'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, type SubmitEvent, useState } from 'react';

import { flag } from '@/components/catalog/table-tools';
import { useCanBilling } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
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
          <Link href="/dashboard/settings" className="font-semibold underline">
            Review business details
          </Link>
          . The compliance form arrives with the operator queue.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Templates" href="/dashboard/templates" action="View all">
          <p className="text-2xl font-bold">{data?.templates ?? '—'}</p>
          <p className="text-muted-foreground text-sm">Create a new template from the list.</p>
        </Card>
        <Card title="Total contacts" href="/dashboard/contacts" action="View all">
          <p className="text-2xl font-bold">{data?.contacts ?? '—'}</p>
        </Card>
        <div className="bg-card rounded-[18px] border p-5 shadow-sm">
          <h2 className="font-semibold">Deliverability</h2>
          <p className="mt-2 text-2xl font-bold">
            {data?.deliverability === null || data === undefined
              ? '—'
              : `${String(Math.round(data.deliverability * 100))}%`}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Delivered divided by messages with a final status.
          </p>
        </div>
        <Card
          title="Balance"
          href={canBill ? '/dashboard/billing' : '/dashboard'}
          action={canBill ? 'Manage' : 'Available'}
        >
          <p className="text-2xl font-bold">{data?.balance.available.display ?? '—'} USD</p>
        </Card>
      </div>
      <div className="bg-card grid gap-4 rounded-[18px] border p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Messages</h2>
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
          <Stat label="Sent" value={String(data?.totals.sent ?? 0)} />
          <Stat label="Delivered" value={String(data?.totals.delivered ?? 0)} />
          <Stat label="Failed" value={String(data?.totals.failed ?? 0)} />
          <Stat label="Spend" value={`${data?.totals.spend.display ?? '0.00'} USD`} />
        </div>
        <UsageChart days={data?.days ?? []} />
      </div>
      <div className="bg-card rounded-[18px] border p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Recent contacts</h2>
          <Link href="/dashboard/contacts" className="text-sm font-semibold underline">
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
                  <td className="py-2 font-mono text-xs">{contact.id.slice(0, 8)}</td>
                  <td className="py-2">
                    {flag(contact.country)} {contact.country} +{contact.dialCode}
                  </td>
                  <td className="py-2 font-mono text-xs">{contact.phone}</td>
                  <td className="py-2">{contact.optedOut ? 'Opted out' : 'Active'}</td>
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
  children,
}: {
  title: string;
  href: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card grid gap-2 rounded-[18px] border p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Link href={href} className="text-sm font-semibold underline">
          {action}
        </Link>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function UsageChart({ days }: { days: Overview['days'] }) {
  const peak = Math.max(1, ...days.map((day) => day.sent));
  if (days.length === 0) {
    return null;
  }
  return (
    <svg
      role="img"
      aria-label="Daily sent messages"
      viewBox={`0 0 ${String(days.length * 16)} 120`}
      className="h-36 min-w-full"
    >
      {days.map((day, index) => {
        const height = Math.round((day.sent / peak) * 100);
        return (
          <rect
            key={day.day}
            x={index * 16 + 3}
            y={110 - height}
            width="10"
            height={height}
            className="fill-primary"
          >
            <title>
              {day.day}: {day.sent} sent
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
