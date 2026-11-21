'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi, type TrafficTally } from '@/lib/admin';

function rate(value: number | null): string {
  return value === null ? '—' : `${String(value)}%`;
}

export default function StatisticsPage() {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const statistics = useQuery({
    queryKey: ['admin-statistics', day],
    queryFn: () => adminApi.statistics(day),
  });
  const data = statistics.data;
  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Statistics</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            One UTC day, split by route and by organization. Delivery is delivered divided by
            messages that reached a final status.
          </p>
        </div>
        <label className="grid gap-1 text-sm">
          Day
          <input
            className="border-input bg-background h-9 rounded-lg border px-3"
            type="date"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
        </label>
      </div>
      <Breakdown
        title="By route"
        rows={(data?.byRoute ?? []).map((row) => ({
          id: row.routeId,
          label: row.providerCode === '' ? 'No route' : row.providerCode,
          detail: row.countryIso2,
          tally: row,
        }))}
      />
      <Breakdown
        title="By organization"
        rows={(data?.byOrganization ?? []).map((row) => ({
          id: row.organizationId,
          label: row.name === '' ? row.organizationId.slice(0, 8) : row.name,
          detail: '',
          tally: row,
        }))}
      />
    </section>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; label: string; detail: string; tally: TrafficTally }[];
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">No messages on this day.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
                <th className="px-3 py-2 font-medium">Failed</th>
                <th className="px-3 py-2 font-medium">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.label}</span>
                    {row.detail === '' ? null : (
                      <span className="text-muted-foreground block text-xs">{row.detail}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.tally.total}</td>
                  <td className="px-3 py-2">{row.tally.sent}</td>
                  <td className="px-3 py-2">{row.tally.delivered}</td>
                  <td className="px-3 py-2">{row.tally.failed}</td>
                  <td className="px-3 py-2">{rate(row.tally.deliveryRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
