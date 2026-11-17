'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';

import { useCanDeveloper } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { developerApi, type ApiKeyItem } from '@/lib/developer';

export default function ApiKeysPage() {
  const canDeveloper = useCanDeveloper();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'LIVE' | 'TEST'>('TEST');
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => developerApi.keys('?page=1&pageSize=100'),
    enabled: canDeveloper,
  });

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = await developerApi.createKey({ name, mode });
      setSecret(created.secret ?? null);
      setName('');
      toast('API key created. Copy it now. It will not be shown again.');
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not create the key.');
    }
  }

  async function act(work: () => Promise<unknown>, message: string) {
    try {
      await work();
      toast(message);
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That action could not be completed.');
    }
  }

  if (!canDeveloper) {
    return (
      <section>
        <h1 className="text-2xl font-bold tracking-tight">API keys</h1>
        <p className="text-muted-foreground mt-2 text-sm">Your role cannot manage API keys.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API keys</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Live keys send and charge the balance. Test keys use the mock provider and are not
          charged.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Organization ID</span>
        <code className="font-mono text-xs">{keys.data?.organizationId ?? '—'}</code>
        <Button
          type="button"
          variant="outline"
          disabled={keys.data === undefined}
          onClick={() => {
            const id = keys.data?.organizationId;
            if (id !== undefined) {
              void navigator.clipboard.writeText(id).then(() => {
                toast('Organization ID copied.');
              });
            }
          }}
        >
          Copy
        </Button>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void create(event)}>
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
        <label className="grid gap-1 text-sm font-medium">
          Mode
          <select
            className="border-input h-9 rounded-lg border px-2 font-normal"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value === 'LIVE' ? 'LIVE' : 'TEST');
            }}
          >
            <option value="TEST">Test</option>
            <option value="LIVE">Live</option>
          </select>
        </label>
        <Button type="submit">Create key</Button>
      </form>
      {secret !== null ? (
        <div className="border-border bg-muted/40 grid gap-2 rounded-xl border p-4" role="status">
          <p className="text-sm font-medium">Copy this key. It is shown only once.</p>
          <code className="font-mono text-xs break-all">{secret}</code>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(() => {
                  toast('API key copied.');
                });
              }}
            >
              Copy key
            </Button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Mode</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Last used</th>
              <th className="py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(keys.data?.items ?? []).map((item) => (
              <KeyRow
                key={item.id}
                item={item}
                onAct={(work, message) => void act(work, message)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeyRow({
  item,
  onAct,
}: {
  item: ApiKeyItem;
  onAct: (work: () => Promise<unknown>, message: string) => void;
}) {
  const [name, setName] = useState(item.name);
  return (
    <tr className="border-border border-t">
      <td className="py-2 pr-2">
        <input
          className="border-input h-8 w-40 rounded-lg border px-2"
          aria-label={`Name for ${item.masked}`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </td>
      <td className="py-2 pr-2 font-mono text-xs">{item.masked}</td>
      <td className="py-2 pr-2">{item.mode}</td>
      <td className="py-2 pr-2">{item.status}</td>
      <td className="py-2 pr-2">{item.createdAt.slice(0, 10)}</td>
      <td className="py-2 pr-2">
        {item.lastUsedAt === null ? 'Never' : item.lastUsedAt.slice(0, 16)}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onAct(() => developerApi.updateKey(item.id, { name }), 'Key renamed.');
            }}
          >
            Rename
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const status = item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
              onAct(
                () => developerApi.updateKey(item.id, { status }),
                status === 'ACTIVE' ? 'Key enabled.' : 'Key disabled.',
              );
            }}
          >
            {item.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onAct(() => developerApi.deleteKey(item.id), 'API key deleted.');
            }}
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}
