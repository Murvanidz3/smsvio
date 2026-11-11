'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';

import { useCanManage, useIsOwner } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

interface Row {
  kind: 'member' | 'invitation';
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  lastSeenAt: string | null;
}

const ROLES = ['ADMIN', 'DEVELOPER', 'BILLING', 'VIEWER'] as const;

export default function UsersPage() {
  const canManage = useCanManage();
  const isOwner = useIsOwner();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('VIEWER');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const query = `?q=${encodeURIComponent(q)}&page=${String(page)}&pageSize=${String(pageSize)}&sort=name&direction=asc`;
  const directory = useQuery({
    queryKey: ['members', query],
    queryFn: () => accountApi.members(query),
  });
  const rows = directory.data?.items ?? [];

  async function invite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await accountApi.invite({ email, role });
      setInviteLink(result.link ?? null);
      toast(result.message);
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not send the invitation.');
    }
  }

  async function act(work: () => Promise<unknown>) {
    try {
      const result = await work();
      if (
        result !== null &&
        typeof result === 'object' &&
        'link' in result &&
        typeof result.link === 'string'
      ) {
        setInviteLink(result.link);
      }
      toast(
        result !== null && typeof result === 'object' && 'message' in result
          ? String(result.message)
          : 'Updated.',
      );
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That action could not be completed.');
    }
  }

  const pages = Math.max(1, Math.ceil((directory.data?.total ?? 0) / pageSize));

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1 text-sm">Members and pending invitations.</p>
        </div>
        <label className="text-sm">
          Page size
          <select
            className="border-input ml-2 h-9 rounded-lg border px-2"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canManage ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void invite(event)}>
          <label className="grid gap-1 text-sm font-medium">
            Email
            <input
              className="border-input h-9 rounded-lg border px-3 font-normal"
              type="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Role
            <select
              className="border-input h-9 rounded-lg border px-2 font-normal"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as (typeof ROLES)[number]);
              }}
            >
              {ROLES.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <Button type="submit">Invite</Button>
        </form>
      ) : null}
      {inviteLink === null ? null : (
        <div className="grid max-w-xl gap-2">
          <p className="text-sm">Copy this link and send it to them. It works once.</p>
          <div className="flex gap-2">
            <input
              className="border-input h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm"
              readOnly
              value={inviteLink}
              aria-label="Invitation link"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(inviteLink).then(() => {
                  toast('Link copied.');
                });
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      )}
      <label className="grid max-w-sm gap-1 text-sm font-medium">
        Search
        <input
          className="border-input h-9 rounded-lg border px-3 font-normal"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
      </label>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              {['Name', 'Email', 'Role', 'Status', 'ID', 'Actions'].map((heading) => (
                <th key={heading} className="px-3 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {directory.isPending ? (
              <tr>
                <td className="text-muted-foreground px-3 py-6" colSpan={6}>
                  Loading people…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-6" colSpan={6}>
                  No people match that search.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.name ?? '—'}</td>
                  <td className="px-3 py-2">{row.email}</td>
                  <td className="px-3 py-2">{row.role}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="font-mono text-xs underline-offset-4 hover:underline"
                      onClick={() => {
                        void navigator.clipboard.writeText(row.id);
                        toast('Copied the full id.');
                      }}
                    >
                      {row.id.slice(0, 8)}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <RowActions row={row} canManage={canManage} isOwner={isOwner} act={act} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => {
            setPage((current) => current - 1);
          }}
        >
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={page >= pages}
          onClick={() => {
            setPage((current) => current + 1);
          }}
        >
          Next
        </Button>
      </div>
    </section>
  );
}

function RowActions({
  row,
  canManage,
  isOwner,
  act,
}: {
  row: Row;
  canManage: boolean;
  isOwner: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  if (!canManage) {
    return null;
  }
  if (row.kind === 'invitation') {
    return (
      <span className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void act(() => accountApi.resendInvite(row.id))}
        >
          Resend
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => void act(() => accountApi.revokeInvite(row.id))}
        >
          Revoke
        </Button>
      </span>
    );
  }
  if (row.role === 'OWNER') {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-2">
      <select
        aria-label={`Role for ${row.email}`}
        className="border-input h-8 rounded-lg border px-2"
        value={row.role}
        onChange={(event) => void act(() => accountApi.changeRole(row.id, event.target.value))}
      >
        {ROLES.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <Button
        type="button"
        variant="destructive"
        onClick={() => void act(() => accountApi.removeMember(row.id))}
      >
        Remove
      </Button>
      {isOwner ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void act(() => accountApi.transfer(row.id))}
        >
          Make owner
        </Button>
      ) : null}
    </span>
  );
}
