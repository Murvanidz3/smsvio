'use client';

import { useQuery } from '@tanstack/react-query';

import { adminApi } from '@/lib/admin';

export default function HealthPage() {
  const health = useQuery({ queryKey: ['admin-health'], queryFn: () => adminApi.system() });
  const queues = health.data?.queues;
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-bold">Health</h1>
      <p className="text-sm">Send queue {queues?.send ?? '…'}</p>
      <p className="text-sm">Delayed sends {queues?.delayed ?? '…'}</p>
      <p className="text-sm">Receipts waiting {queues?.receipts ?? '…'}</p>
      <p className="text-sm">Webhook queue {queues?.webhooks ?? '…'}</p>
      <p className="text-sm">
        Messages sent and still open after 5 minutes {health.data?.receiptLag ?? '…'}
      </p>
    </section>
  );
}
