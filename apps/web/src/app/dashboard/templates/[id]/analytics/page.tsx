'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { catalogApi } from '@/lib/catalog';

const RANGES = [7, 30, 90] as const;

export default function TemplateAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const template = useQuery({
    queryKey: ['template', id],
    queryFn: () => catalogApi.template(id),
  });
  const analytics = useQuery({
    queryKey: ['template-analytics', id, days],
    queryFn: () => catalogApi.analytics(id, days),
  });
  const points = analytics.data?.points ?? [];
  const peak = Math.max(1, ...points.map((point) => point.sent));

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {template.data?.name ?? 'Template'} analytics
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Sent, delivered, and failed messages for this template.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/templates/${id}`}>Back to template</Link>
        </Button>
      </div>
      <div className="flex gap-2">
        {RANGES.map((range) => (
          <Button
            key={range}
            type="button"
            variant={days === range ? 'default' : 'outline'}
            onClick={() => {
              setDays(range);
            }}
          >
            {range} days
          </Button>
        ))}
      </div>
      {analytics.isPending || analytics.data === undefined ? (
        <div className="bg-muted h-48 animate-pulse rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Sent" value={analytics.data.sent} />
            <Stat label="Delivered" value={analytics.data.delivered} />
            <Stat label="Failed" value={analytics.data.failed} />
          </div>
          {analytics.data.sent + analytics.data.delivered + analytics.data.failed === 0 ? (
            <p className="text-muted-foreground text-sm">
              No messages have been sent with this template in this range.
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-2xl border p-4">
            <svg
              role="img"
              aria-label="Daily sent messages"
              viewBox={`0 0 ${String(points.length * 16)} 120`}
              className="h-36 min-w-full"
            >
              {points.map((point, index) => {
                const height = Math.round((point.sent / peak) * 100);
                return (
                  <g key={point.date}>
                    <rect
                      x={index * 16 + 3}
                      y={110 - height}
                      width="10"
                      height={height}
                      className="fill-primary"
                    >
                      <title>
                        {point.date}: {point.sent} sent
                      </title>
                    </rect>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
