'use client';

import { useQuery } from '@tanstack/react-query';

import { adminApi } from '@/lib/admin';

export default function AuditPage() {
  const audit = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => adminApi.audit('?page=1&pageSize=25'),
  });
  return (
    <section className="grid gap-3">
      <h1 className="text-2xl font-bold">Audit</h1>
      {(audit.data?.items ?? []).map((item) => (
        <p key={item.id} className="text-sm">
          {item.createdAt} · {item.action}
        </p>
      ))}
    </section>
  );
}
