'use client';

import { useQuery } from '@tanstack/react-query';

import { adminApi } from '@/lib/admin';

export default function MarginPage() {
  const margin = useQuery({ queryKey: ['admin-margin'], queryFn: () => adminApi.margin() });
  const items = margin.data?.items ?? [];
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-bold">Margin</h1>
      <p className="text-muted-foreground text-sm">
        Revenue minus carrier cost for the last 30 days.
      </p>
      {items.length === 0 ? <p className="text-sm">No billable traffic in this window.</p> : null}
      {items.map((item) => (
        <p key={`${item.country}:${item.providerId}`} className="text-sm">
          {item.country || '—'} · revenue {item.revenue.display} · cost {item.cost.display} · margin{' '}
          {item.margin.display} USD
        </p>
      ))}
    </section>
  );
}
