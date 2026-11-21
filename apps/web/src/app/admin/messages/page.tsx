'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi } from '@/lib/admin';

const STATUSES = [
  '',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'UNDELIVERED',
  'EXPIRED',
  'FAILED',
  'REJECTED',
] as const;

export default function AdminMessagesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const params = new URLSearchParams({ page: '1', pageSize: '25' });
  if (q !== '') {
    params.set('q', q);
  }
  if (status !== '') {
    params.set('status', status);
  }
  if (errorCode !== '') {
    params.set('errorCode', errorCode);
  }
  const query = params.toString();
  const messages = useQuery({
    queryKey: ['admin-messages', query],
    queryFn: () => adminApi.messages(`?${query}`),
  });
  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Search every organization by number, id, status, or error code.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="border-input h-10 max-w-sm rounded-lg border px-3"
          placeholder="Number or id"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
        <select
          className="border-input h-10 rounded-lg border px-3"
          value={status}
          aria-label="Status"
          onChange={(event) => {
            setStatus(event.target.value);
          }}
        >
          {STATUSES.map((item) => (
            <option key={item} value={item}>
              {item === '' ? 'Any status' : item}
            </option>
          ))}
        </select>
        <input
          className="border-input h-10 max-w-xs rounded-lg border px-3"
          placeholder="Error code"
          value={errorCode}
          onChange={(event) => {
            setErrorCode(event.target.value);
          }}
        />
      </div>
      <p className="text-muted-foreground text-sm">{messages.data?.total ?? 0} messages</p>
      {(messages.data?.items ?? []).map((item) => (
        <p key={item.id} className="font-mono text-xs">
          {item.id.slice(0, 8)} {item.direction} {item.countryIso2 ?? ''} {item.to} {item.status}{' '}
          {item.errorCode ?? ''}
        </p>
      ))}
    </section>
  );
}
