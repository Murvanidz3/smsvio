'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { adminApi, type AdminOrganization } from '@/lib/admin';
import { ApiError } from '@/lib/api';

const field = 'border-input bg-background h-9 rounded-lg border px-3 text-sm';

export default function AdminOrganizationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [cap, setCap] = useState('');
  const [senderDraft, setSenderDraft] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<AdminOrganization | null>(null);
  const [capping, setCapping] = useState<AdminOrganization | null>(null);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
  const list = useQuery({
    queryKey: ['admin-organizations', query.toString()],
    queryFn: () => adminApi.organizations(`?${query.toString()}`),
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const sender = senderDraft ?? list.data?.sharedSender ?? '';

  async function saveSharedSender() {
    const next = sender.trim();
    setBusy(true);
    try {
      const result = await adminApi.setSharedSender(next);
      toast(result.message);
      setSenderDraft(next);
      await queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not save the shared sender.');
    } finally {
      setBusy(false);
    }
  }

  async function savePlatformCap() {
    setBusy(true);
    try {
      const result = await adminApi.setPlatformCap(cap);
      toast(result.message);
      setCap('');
      await queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not save the spend cap.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(organization: AdminOrganization) {
    setBusy(true);
    try {
      const next = organization.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
      const result = await adminApi.setStatus(organization.id, next);
      toast(result.message);
      await queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not change that status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Platform daily spend cap is {list.data?.platformSpendCap.display ?? '…'} USD. An
          organization without its own cap uses this amount.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void savePlatformCap();
        }}
      >
        <label className="grid gap-1 text-sm">
          New platform cap (USD)
          <input
            className={field}
            inputMode="decimal"
            value={cap}
            onChange={(event) => {
              setCap(event.target.value);
            }}
            required
          />
        </label>
        <Button type="submit" disabled={busy}>
          Save platform cap
        </Button>
      </form>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void saveSharedSender();
        }}
      >
        <label className="grid gap-1 text-sm">
          Shared sender
          <input
            className={field}
            inputMode="numeric"
            value={sender}
            placeholder="12025550199"
            onChange={(event) => {
              setSenderDraft(event.target.value);
            }}
          />
        </label>
        <Button type="submit" disabled={busy}>
          Save shared sender
        </Button>
        <p className="text-muted-foreground basis-full text-sm">
          Digits only. This is the number on the Senders page. Leave it blank to hide that sentence.
        </p>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="grid gap-1 text-sm">
          Search
          <input
            className={`${field} w-64`}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <p className="text-muted-foreground text-sm">{showing(total, page, pageSize)}</p>
        <PageSize
          value={pageSize}
          onChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">Organization</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Available</th>
              <th className="px-3 py-2 font-medium">Held</th>
              <th className="px-3 py-2 font-medium">Daily cap</th>
              <th className="bg-muted sticky right-0 px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={6}>
                  No organizations match that search.
                </td>
              </tr>
            ) : (
              rows.map((organization) => (
                <tr key={organization.id} className="border-t">
                  <td className="px-3 py-2">
                    {organization.name}
                    {organization.legalName === null ? '' : ` · ${organization.legalName}`}
                  </td>
                  <td className="px-3 py-2">{organization.status}</td>
                  <td className="px-3 py-2">{organization.available.display}</td>
                  <td className="px-3 py-2">{organization.held.display}</td>
                  <td className="px-3 py-2">
                    {organization.spendCap.display}{' '}
                    <span className="text-muted-foreground">({organization.spendCapSource})</span>
                  </td>
                  <td className="bg-background sticky right-0 z-10 px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setAdjusting(organization);
                        }}
                      >
                        Credit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setCapping(organization);
                        }}
                      >
                        Cap
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void setStatus(organization);
                        }}
                      >
                        {organization.status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
      {adjusting === null ? null : (
        <AdjustDialog
          organization={adjusting}
          busy={busy}
          onCancel={() => {
            setAdjusting(null);
          }}
          onSubmit={async (body) => {
            setBusy(true);
            try {
              const result = await adminApi.adjust(adjusting.id, body);
              toast(result.message);
              setAdjusting(null);
              await queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'Could not adjust that balance.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {capping === null ? null : (
        <CapDialog
          organization={capping}
          busy={busy}
          onCancel={() => {
            setCapping(null);
          }}
          onSubmit={async (dailySpendCap) => {
            setBusy(true);
            try {
              const result = await adminApi.setSpendCap(capping.id, dailySpendCap);
              toast(result.message);
              setCapping(null);
              await queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'Could not save that cap.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function AdjustDialog({
  organization,
  busy,
  onCancel,
  onSubmit,
}: {
  organization: AdminOrganization;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    direction: 'credit' | 'debit';
    amount: string;
    reason: string;
  }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    node.showModal();
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${String(scrollY)}px`;
    body.style.width = '100%';
    return () => {
      node.close();
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="adjust-title"
      className="bg-popover m-auto w-[min(100%-2rem,28rem)] max-w-md rounded-xl border p-5 backdrop:bg-black/40"
      style={{ overflow: 'visible' }}
    >
      <form
        aria-labelledby="adjust-title"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ direction, amount, reason });
        }}
      >
        <h2 id="adjust-title" className="text-lg font-semibold">
          Adjust {organization.name}
        </h2>
        <label className="mt-4 grid gap-1 text-sm">
          Direction
          <select
            className={field}
            value={direction}
            onChange={(event) => {
              setDirection(event.target.value === 'debit' ? 'debit' : 'credit');
            }}
          >
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
          </select>
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Amount
          <input
            className={field}
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            required
          />
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Reason
          <textarea
            className="border-input bg-background min-h-16 w-full rounded-lg border px-3 py-2 text-sm"
            value={reason}
            minLength={3}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            required
          />
        </label>
        <div className="mt-5 grid gap-2">
          <Button
            type="submit"
            style={{ height: '3rem', width: '100%', pointerEvents: 'auto' }}
            disabled={busy}
          >
            Apply
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

function CapDialog({
  organization,
  busy,
  onCancel,
  onSubmit,
}: {
  organization: AdminOrganization;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (dailySpendCap: string | null) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [inherit, setInherit] = useState(organization.spendCapSource === 'platform');
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <form
        className="bg-popover w-full max-w-md rounded-xl border p-5"
        role="dialog"
        aria-labelledby="cap-title"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(inherit ? null : amount);
        }}
      >
        <h2 id="cap-title" className="text-lg font-semibold">
          Daily cap for {organization.name}
        </h2>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inherit}
            onChange={(event) => {
              setInherit(event.target.checked);
            }}
          />
          Use the platform default
        </label>
        {inherit ? null : (
          <label className="mt-3 grid gap-1 text-sm">
            Daily cap (USD)
            <input
              className={field}
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
              required
            />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save cap
          </Button>
        </div>
      </form>
    </div>
  );
}
