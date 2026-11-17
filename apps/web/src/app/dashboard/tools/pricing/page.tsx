'use client';

import { estimateMonthlyBill, formatMicros } from '@smsvio/shared/billing';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { flag } from '@/components/catalog/table-tools';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { insightApi } from '@/lib/billing';

interface Share {
  country: string;
  share: string;
}

export default function PricingPage() {
  const rates = useQuery({ queryKey: ['pricing-rates'], queryFn: () => insightApi.rates() });
  const toast = useToast();
  const [needle, setNeedle] = useState('');
  const [messages, setMessages] = useState('10000');
  const [segments, setSegments] = useState('1');
  const [shares, setShares] = useState<Share[]>([{ country: 'DE', share: '100' }]);
  const items = useMemo(() => rates.data?.items ?? [], [rates.data?.items]);
  const visible = items.filter((item) => {
    const query = needle.trim().toLowerCase();
    if (query === '') {
      return true;
    }
    return (
      item.country.toLowerCase().includes(query) ||
      item.name.toLowerCase().includes(query) ||
      item.dialCode.includes(query)
    );
  });
  const estimate = useMemo(() => {
    const priceByCountry = new Map(items.map((item) => [item.country, BigInt(item.price.micros)]));
    return estimateMonthlyBill({
      monthlyMessages: Number(messages),
      segments: Number(segments),
      destinations: shares.map((share) => ({
        country: share.country,
        sharePercent: Number(share.share),
        priceMicros: priceByCountry.get(share.country) ?? 0n,
      })),
    });
  }, [items, messages, segments, shares]);

  function copyEstimate() {
    if ('error' in estimate) {
      toast(estimate.error);
      return;
    }
    const lines = estimate.lines.map(
      (line) =>
        `${line.country}: ${String(line.messages)} messages × ${String(line.segments)} × ${formatMicros(line.priceMicros, 4)} = ${formatMicros(line.costMicros, 2)} USD`,
    );
    lines.push(`Total ${formatMicros(estimate.totalMicros, 2)} USD`);
    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      toast('Estimate copied.');
    });
  }

  function downloadCsv() {
    const header = 'country,name,dial_code,price_usd';
    const body = items
      .map((item) => `${item.country},"${item.name}",${item.dialCode},${item.price.display}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([`${header}\n${body}\n`], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'smsvio-rates.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="grid gap-8">
      <div>
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Estimate a month from your destination mix, then look up the price per segment.
        </p>
      </div>
      <div className="bg-card grid max-w-3xl gap-4 rounded-[18px] border p-5 shadow-sm">
        <h2 className="font-semibold">Calculator</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Monthly messages
            <input
              className="border-input h-10 rounded-lg border px-3 font-normal"
              inputMode="numeric"
              value={messages}
              onChange={(event) => {
                setMessages(event.target.value);
              }}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Average segments
            <input
              className="border-input h-10 rounded-lg border px-3 font-normal"
              inputMode="numeric"
              value={segments}
              onChange={(event) => {
                setSegments(event.target.value);
              }}
            />
          </label>
        </div>
        {shares.map((share, index) => (
          <div key={`${share.country}-${String(index)}`} className="flex flex-wrap gap-2">
            <label className="grid gap-1 text-sm font-medium">
              Destination
              <input
                className="border-input h-10 w-24 rounded-lg border px-3 font-normal uppercase"
                maxLength={2}
                value={share.country}
                onChange={(event) => {
                  const next = shares.slice();
                  const row = next[index];
                  if (row === undefined) {
                    return;
                  }
                  next[index] = { ...row, country: event.target.value.toUpperCase() };
                  setShares(next);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Share %
              <input
                className="border-input h-10 w-24 rounded-lg border px-3 font-normal"
                inputMode="numeric"
                value={share.share}
                onChange={(event) => {
                  const next = shares.slice();
                  const row = next[index];
                  if (row === undefined) {
                    return;
                  }
                  next[index] = { ...row, share: event.target.value };
                  setShares(next);
                }}
              />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShares([...shares, { country: '', share: '0' }]);
            }}
          >
            Add destination
          </Button>
          <Button type="button" variant="outline" onClick={copyEstimate}>
            Copy estimate
          </Button>
        </div>
        {'error' in estimate ? (
          <p className="text-sm">{estimate.error}</p>
        ) : (
          <div className="grid gap-2 text-sm">
            {estimate.lines.map((line) => (
              <p key={line.country}>
                {line.country}: {line.messages} messages, {formatMicros(line.costMicros, 2)} USD
              </p>
            ))}
            <p className="text-lg font-bold">{formatMicros(estimate.totalMicros, 2)} USD</p>
          </div>
        )}
      </div>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Rates</h2>
          <Button type="button" variant="outline" onClick={downloadCsv}>
            Download CSV
          </Button>
        </div>
        <input
          className="border-input h-10 max-w-sm rounded-lg border px-3"
          placeholder="Search country"
          value={needle}
          onChange={(event) => {
            setNeedle(event.target.value);
          }}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Country</th>
                <th className="py-2 font-medium">Dial</th>
                <th className="py-2 font-medium">Price / segment</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.country} className="border-border border-t">
                  <td className="py-2">
                    {flag(item.country)} {item.name}
                  </td>
                  <td className="py-2 font-mono text-xs">+{item.dialCode}</td>
                  <td className="py-2 font-mono text-xs">{item.price.display} USD</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">No priced destinations match.</p>
        ) : null}
      </div>
    </section>
  );
}
