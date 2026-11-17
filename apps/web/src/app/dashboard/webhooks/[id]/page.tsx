'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { useCanDeveloper } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { developerApi } from '@/lib/developer';

export default function WebhookDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const canDeveloper = useCanDeveloper();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const webhook = useQuery({
    queryKey: ['webhook', id],
    queryFn: () => developerApi.webhook(id, '?page=1&pageSize=50'),
    enabled: canDeveloper && id.length > 0,
  });

  async function act(work: () => Promise<unknown>, done: string) {
    try {
      const result = await work();
      if (
        result !== null &&
        typeof result === 'object' &&
        'secret' in result &&
        typeof result.secret === 'string'
      ) {
        setSecret(result.secret);
      }
      toast(done);
      await queryClient.invalidateQueries({ queryKey: ['webhook', id] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That action could not be completed.');
    }
  }

  if (!canDeveloper) {
    return (
      <section>
        <h1 className="text-2xl font-bold tracking-tight">Webhook</h1>
        <p className="text-muted-foreground mt-2 text-sm">Your role cannot manage webhooks.</p>
      </section>
    );
  }

  const item = webhook.data;

  return (
    <section className="grid gap-6">
      <div>
        <Link className="text-muted-foreground text-sm underline" href="/dashboard/webhooks">
          Webhooks
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{item?.name ?? 'Webhook'}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{item?.url}</p>
      </div>
      {item === undefined ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void act(() => developerApi.revealWebhook(id), 'Signing secret revealed.');
            }}
          >
            Reveal secret
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void act(() => developerApi.rotateWebhook(id), 'Signing secret rotated.');
            }}
          >
            Rotate secret
          </Button>
          <Button
            type="button"
            onClick={() => {
              void act(() => developerApi.testWebhook(id), 'Test event queued.');
            }}
          >
            Send test event
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const status = item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
              void act(
                () => developerApi.updateWebhook(id, { status }),
                status === 'ACTIVE' ? 'Webhook enabled.' : 'Webhook disabled.',
              );
            }}
          >
            {item.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void developerApi.deleteWebhook(id).then(() => {
                toast('Webhook deleted.');
                router.push('/dashboard/webhooks');
              });
            }}
          >
            Delete
          </Button>
        </div>
      )}
      {secret !== null ? (
        <div className="border-border bg-muted/40 grid gap-2 rounded-xl border p-4" role="status">
          <p className="text-sm font-medium">Signing secret</p>
          <code className="font-mono text-xs break-all">{secret}</code>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Event</th>
              <th className="py-2 font-medium">Attempt</th>
              <th className="py-2 font-medium">Response</th>
              <th className="py-2 font-medium">Duration</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Replay</th>
            </tr>
          </thead>
          <tbody>
            {(item?.deliveries.items ?? []).map((delivery) => (
              <tr key={delivery.id} className="border-border border-t">
                <td className="py-2 pr-2 font-mono text-xs">{delivery.eventType}</td>
                <td className="py-2 pr-2">{delivery.attempt}</td>
                <td className="py-2 pr-2">{delivery.responseStatus ?? '—'}</td>
                <td className="py-2 pr-2">
                  {delivery.responseMs === null ? '—' : `${String(delivery.responseMs)} ms`}
                </td>
                <td className="py-2 pr-2">{delivery.status}</td>
                <td className="py-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void act(
                        () => developerApi.replayWebhook(id, delivery.id),
                        'Delivery queued again.',
                      );
                    }}
                  >
                    Replay
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
