'use client';

import { WEBHOOK_EVENT_GROUPS } from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { useCanDeveloper } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { developerApi } from '@/lib/developer';

export default function WebhooksPage() {
  const canDeveloper = useCanDeveloper();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [events, setEvents] = useState<string[]>(['message.delivered']);
  const [secret, setSecret] = useState<string | null>(null);
  const webhooks = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => developerApi.webhooks('?page=1&pageSize=100'),
    enabled: canDeveloper,
  });

  function toggle(eventName: string, checked: boolean) {
    setEvents((current) =>
      checked ? [...current, eventName] : current.filter((item) => item !== eventName),
    );
  }

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await developerApi.createWebhook({ name, url, events });
      setSecret(created.secret);
      setName('');
      toast('Webhook created. Copy the signing secret now.');
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not create the webhook.');
    }
  }

  if (!canDeveloper) {
    return (
      <section>
        <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground mt-2 text-sm">Your role cannot manage webhooks.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Signed HTTPS callbacks for message, contact, template, sender, and billing events.
        </p>
      </div>
      <form className="grid gap-4" onSubmit={(event) => void create(event)}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Name
            <input
              className="border-input h-9 rounded-lg border px-3 font-normal"
              required
              maxLength={80}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label className="grid min-w-72 flex-1 gap-1 text-sm font-medium">
            HTTPS URL
            <input
              className="border-input h-9 rounded-lg border px-3 font-normal"
              required
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
              }}
            />
          </label>
          <Button type="submit" disabled={events.length === 0}>
            Add webhook
          </Button>
        </div>
        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">Events</legend>
          {WEBHOOK_EVENT_GROUPS.map((group) => (
            <div key={group.id} className="grid gap-1">
              <p className="text-muted-foreground text-xs font-semibold tracking-wide">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {group.events.map((eventName) => (
                  <label key={eventName} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={events.includes(eventName)}
                      onChange={(event) => {
                        toggle(eventName, event.target.checked);
                      }}
                    />
                    <span className="font-mono text-xs">{eventName}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      </form>
      {secret !== null ? (
        <div className="border-border bg-muted/40 grid gap-2 rounded-xl border p-4" role="status">
          <p className="text-sm font-medium">
            Copy this signing secret. You can reveal it again from the webhook.
          </p>
          <code className="font-mono text-xs break-all">{secret}</code>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">ID</th>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Endpoint</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {(webhooks.data?.items ?? []).map((item) => (
              <tr key={item.id} className="border-border border-t">
                <td className="py-2 pr-2 font-mono text-xs">
                  <Link className="underline" href={`/dashboard/webhooks/${item.id}`}>
                    {item.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-2 pr-2">{item.name}</td>
                <td className="max-w-xs truncate py-2 pr-2 font-mono text-xs">{item.url}</td>
                <td className="py-2 pr-2">{item.status}</td>
                <td className="py-2">{item.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
