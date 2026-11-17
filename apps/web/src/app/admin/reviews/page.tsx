'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode } from 'react';

import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/admin';
import { ApiError } from '@/lib/api';

export default function ReviewsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const reviews = useQuery({ queryKey: ['admin-reviews'], queryFn: () => adminApi.reviews() });

  function decide(path: string, id: string, decision: 'approve' | 'reject') {
    void adminApi
      .decide(path, id, decision, '')
      .then(async (result) => {
        toast(result.message);
        await queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
      })
      .catch((error: unknown) => {
        toast(error instanceof ApiError ? error.message : 'Could not save that decision.');
      });
  }

  const data = reviews.data;
  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-bold">Reviews</h1>
      <Queue
        title="Verification"
        empty="No businesses are waiting."
        count={data?.verification.length ?? 0}
      >
        {(data?.verification ?? []).map((item) => (
          <Row
            key={item.organizationId}
            label={`${item.name} · ${item.legalName}`}
            onApprove={() => {
              decide('verification', item.organizationId, 'approve');
            }}
            onReject={() => {
              decide('verification', item.organizationId, 'reject');
            }}
          />
        ))}
      </Queue>
      <Queue title="Use cases" empty="No use cases are waiting." count={data?.useCases.length ?? 0}>
        {(data?.useCases ?? []).map((item) => (
          <Row
            key={item.id}
            label={item.purpose}
            onApprove={() => {
              decide('use-cases', item.id, 'approve');
            }}
            onReject={() => {
              decide('use-cases', item.id, 'reject');
            }}
          />
        ))}
      </Queue>
      <Queue title="Senders" empty="No senders are waiting." count={data?.senders.length ?? 0}>
        {(data?.senders ?? []).map((item) => (
          <Row
            key={item.id}
            label={item.value}
            onApprove={() => {
              decide('senders', item.id, 'approve');
            }}
            onReject={() => {
              decide('senders', item.id, 'reject');
            }}
          />
        ))}
      </Queue>
      <Queue
        title="Templates"
        empty="No templates are waiting."
        count={data?.templates.length ?? 0}
      >
        {(data?.templates ?? []).map((item) => (
          <Row
            key={item.id}
            label={item.name}
            onApprove={() => {
              decide('templates', item.id, 'approve');
            }}
            onReject={() => {
              decide('templates', item.id, 'reject');
            }}
          />
        ))}
      </Queue>
    </section>
  );
}

function Queue({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <h2 className="font-semibold">{title}</h2>
      {children}
      {count === 0 ? <p className="text-muted-foreground text-sm">{empty}</p> : null}
    </div>
  );
}

function Row({
  label,
  onApprove,
  onReject,
}: {
  label: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex gap-2">
        <Button type="button" onClick={onApprove}>
          Approve
        </Button>
        <Button type="button" variant="outline" onClick={onReject}>
          Reject
        </Button>
      </span>
    </div>
  );
}
