'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { adminApi, formText } from '@/lib/admin';
import { ApiError } from '@/lib/api';

const field = 'border-input bg-background h-9 w-full rounded-lg border px-3 text-sm';

export default function ProvidersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ['admin-providers'],
    queryFn: () => adminApi.providers(),
  });
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Each provider has its own markup. Credentials stay encrypted and are never shown again.
          The mock provider is simulated and does not send messages. It stays until Phase 7.
        </p>
      </div>
      {secret === null ? null : (
        <p className="bg-muted rounded-xl border px-4 py-3 text-sm">
          Callback secret, shown once: <span className="font-mono">{secret}</span>
        </p>
      )}
      <form
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const config = formText(form, 'config').trim();
          setBusy(true);
          void adminApi
            .createProvider({
              code: formText(form, 'code'),
              type: formText(form, 'type'),
              markupPercent: Number(formText(form, 'markup')),
              maxTps: Number(formText(form, 'maxTps')),
              ...(config === '' ? {} : { config }),
            })
            .then(async (result) => {
              setSecret(result.callbackSecret);
              toast(result.message);
              formElement.reset();
              await queryClient.invalidateQueries({ queryKey: ['admin-providers'] });
            })
            .catch((error: unknown) => {
              toast(error instanceof ApiError ? error.message : 'Could not save that provider.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <label className="grid gap-1 text-sm">
          Code
          <input className={field} name="code" required minLength={2} maxLength={32} />
        </label>
        <label className="grid gap-1 text-sm">
          Type
          <select className={field} name="type" defaultValue="MOCK">
            <option value="MOCK">Mock</option>
            <option value="SMPP">SMPP</option>
            <option value="HTTP">HTTP</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Markup percent
          <input
            className={field}
            name="markup"
            type="number"
            min={0}
            max={1000}
            required
            defaultValue={50}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Max messages / second
          <input
            className={field}
            name="maxTps"
            type="number"
            min={1}
            max={10000}
            required
            defaultValue={100}
          />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Credentials JSON
          <textarea
            className="border-input bg-background min-h-20 w-full rounded-lg border px-3 py-2 text-sm"
            name="config"
          />
        </label>
        <Button type="submit" disabled={busy} className="sm:col-span-2 sm:justify-self-start">
          Add provider
        </Button>
      </form>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Markup</th>
              <th className="px-3 py-2 font-medium">Throughput</th>
              <th className="px-3 py-2 font-medium">Routes</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(providers.data?.items.length ?? 0) === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={7}>
                  No providers yet.
                </td>
              </tr>
            ) : (
              providers.data?.items.map((provider) => (
                <tr key={provider.id} className="border-t">
                  <td className="px-3 py-2">{provider.code}</td>
                  <td className="px-3 py-2">
                    {provider.type === 'MOCK' ? 'Simulated' : provider.type}
                  </td>
                  <td className="px-3 py-2">{provider.status}</td>
                  <td className="px-3 py-2">{provider.markupPercent}%</td>
                  <td className="px-3 py-2">{provider.maxTps}/s</td>
                  <td className="px-3 py-2">{provider.routes}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void adminApi
                          .health(provider.id)
                          .then((result) => {
                            toast(result.ok ? 'Provider is healthy.' : result.detail);
                          })
                          .catch((error: unknown) => {
                            toast(
                              error instanceof ApiError ? error.message : 'Health check failed.',
                            );
                          });
                      }}
                    >
                      Check health
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
