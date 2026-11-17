'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '@/lib/admin';

export default function AdminMessagesPage() {
  const [q, setQ] = useState('');
  const messages = useQuery({
    queryKey: ['admin-messages', q],
    queryFn: () => adminApi.messages(`?q=${encodeURIComponent(q)}&page=1&pageSize=25`),
  });
  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-bold">Messages</h1>
      <input
        className="border-input h-10 max-w-sm rounded-lg border px-3"
        placeholder="Number or id"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
        }}
      />
      <p className="text-muted-foreground text-sm">{messages.data?.total ?? 0} messages</p>
      {(messages.data?.items ?? []).map((item) => (
        <p key={item.id} className="font-mono text-xs">
          {item.id.slice(0, 8)} {item.direction} {item.to} {item.status}
        </p>
      ))}
    </section>
  );
}
