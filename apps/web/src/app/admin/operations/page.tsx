'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/catalog/confirm';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/admin';
import { ApiError } from '@/lib/api';

function rate(value: number | null): string {
  return value === null ? '—' : `${String(value)}%`;
}

export default function OperationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);
  const operations = useQuery({
    queryKey: ['admin-operations'],
    queryFn: () => adminApi.operations(),
    refetchInterval: 15_000,
  });
  const data = operations.data;

  function setPaused(paused: boolean) {
    setBusy(true);
    void adminApi
      .setSendingPaused(paused)
      .then(async (result) => {
        toast(result.message);
        setConfirmPause(false);
        await queryClient.invalidateQueries({ queryKey: ['admin-operations'] });
      })
      .catch((error: unknown) => {
        toast(error instanceof ApiError ? error.message : 'Could not change sending.');
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Today’s traffic by route. Pausing stops new accepts and new submits. Receipts still
            arrive.
          </p>
        </div>
        <Button
          type="button"
          variant={data?.paused === true ? 'default' : 'destructive'}
          disabled={data === undefined || busy}
          onClick={() => {
            if (data?.paused === true) {
              setPaused(false);
              return;
            }
            setConfirmPause(true);
          }}
        >
          {data?.paused === true ? 'Resume sending' : 'Pause sending'}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Today" value={String(data?.today.total ?? '…')} />
        <Stat label="Delivered" value={String(data?.today.delivered ?? '…')} />
        <Stat label="Failed" value={String(data?.today.failed ?? '…')} />
        <Stat label="Delivery" value={data === undefined ? '…' : rate(data.today.deliveryRate)} />
      </div>
      <p className="text-muted-foreground text-sm">
        Queue {data?.queues.send ?? '…'} · delayed {data?.queues.delayed ?? '…'} · receipts{' '}
        {data?.queues.receipts ?? '…'}
        {data?.paused === true ? ' · sending is paused' : ''}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground border-b text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Route</th>
              <th className="px-3 py-2 font-medium">Limit</th>
              <th className="px-3 py-2 font-medium">Last minute</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Delivered</th>
              <th className="px-3 py-2 font-medium">Failed</th>
              <th className="px-3 py-2 font-medium">Delivery</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.routes ?? []).map((route) => (
              <tr key={route.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium">{route.providerCode}</span>
                  <span className="text-muted-foreground block text-xs">
                    {route.countryIso2}
                    {route.mccmnc === null ? '' : ` · ${route.mccmnc}`} · {route.providerType}
                  </span>
                </td>
                <td className="px-3 py-2">{route.maxTps}</td>
                <td className="px-3 py-2">{route.lastMinute}</td>
                <td className="px-3 py-2">{route.total}</td>
                <td className="px-3 py-2">{route.delivered}</td>
                <td className="px-3 py-2">{route.failed}</td>
                <td className="px-3 py-2">{rate(route.deliveryRate)}</td>
                <td className="px-3 py-2">{route.enabled ? 'On' : 'Off'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 className="text-lg font-semibold">Open sends</h2>
        <p className="text-muted-foreground mt-1 text-sm">Queued or still with the worker.</p>
        {(data?.open.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm">Nothing is waiting.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {(data?.open ?? []).map((item) => (
              <li key={item.id} className="font-mono text-xs">
                {item.id.slice(0, 8)} {item.status} {item.countryIso2 ?? ''} {item.to}{' '}
                {item.organizationName}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmPause ? (
        <ConfirmDialog
          title="Pause sending?"
          confirmLabel="Pause"
          pending={busy}
          onCancel={() => {
            setConfirmPause(false);
          }}
          onConfirm={() => {
            setPaused(true);
          }}
        >
          New messages are refused and the worker stops submitting what is already queued. Delivery
          receipts keep updating.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}
