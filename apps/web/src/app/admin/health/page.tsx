'use client';

import { useQuery } from '@tanstack/react-query';

import { adminApi } from '@/lib/admin';

export default function HealthPage() {
  const health = useQuery({ queryKey: ['admin-health'], queryFn: () => adminApi.system() });
  const queues = health.data?.queues;
  const groups = health.data?.errorGroups ?? [];
  const stuck = health.data?.stuck ?? [];
  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Health</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Queue depth, receipts that have not come back, and why sends failed in the last 24 hours.
        </p>
      </div>
      <div className="grid gap-2 text-sm">
        <p>Send queue {queues?.send ?? '…'}</p>
        <p>Delayed sends {queues?.delayed ?? '…'}</p>
        <p>Receipts waiting {queues?.receipts ?? '…'}</p>
        <p>Webhook queue {queues?.webhooks ?? '…'}</p>
        <p>Messages sent and still open after 5 minutes {health.data?.receiptLag ?? '…'}</p>
      </div>
      <div>
        <h2 className="text-lg font-semibold">Failure reasons</h2>
        {groups.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No failures in the last 24 hours.</p>
        ) : (
          <ul className="mt-2 grid gap-1 text-sm">
            {groups.map((group) => (
              <li key={group.errorCode}>
                {group.errorCode} · {group.count}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="text-lg font-semibold">Stuck receipts</h2>
        {stuck.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No sent message has been waiting more than 5 minutes.
          </p>
        ) : (
          <ul className="mt-2 grid gap-1 font-mono text-xs">
            {stuck.map((row) => (
              <li key={row.id}>
                {row.id.slice(0, 8)} {row.to} {row.sentAt ?? ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
