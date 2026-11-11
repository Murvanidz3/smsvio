'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';

import { ConfirmDialog } from '@/components/catalog/confirm';
import { flag, PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { useCanMessage } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { catalogApi, type ContactDetail } from '@/lib/catalog';

type Sort = 'createdAt' | 'name' | 'phone';

export default function ContactsPage() {
  const canMessage = useCanMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [optedOut, setOptedOut] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<Sort>('createdAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ContactDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => catalogApi.countries() });
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
    sort,
    direction,
    ...(country === '' ? {} : { country }),
    ...(optedOut === '' ? {} : { optedOut }),
  });
  const list = useQuery({
    queryKey: ['contacts', query.toString()],
    queryFn: () => catalogApi.contacts(`?${query.toString()}`),
  });
  const detail = useQuery({
    queryKey: ['contact', openId],
    queryFn: () => catalogApi.contact(openId ?? ''),
    enabled: openId !== null,
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const dials = new Map((countries.data?.items ?? []).map((item) => [item.iso2, item.dialCode]));

  function sortBy(next: Sort) {
    setDirection(sort === next && direction === 'asc' ? 'desc' : 'asc');
    setSort(next);
  }

  async function remove(contact: ContactDetail) {
    setBusy(true);
    try {
      const result = await catalogApi.deleteContact(contact.id);
      toast(result.message);
      setPendingDelete(null);
      setOpenId(null);
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not delete that contact.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Numbers this organization can write to.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PageSize
            value={pageSize}
            onChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
          {canMessage ? (
            <Button
              type="button"
              onClick={() => {
                setCreating(true);
              }}
            >
              Create contact
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-1 text-sm font-medium">
          Search
          <input
            className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <details className="relative">
          <summary className="border-input flex h-9 cursor-pointer list-none items-center rounded-lg border px-3 text-sm font-medium">
            Filters
          </summary>
          <div className="bg-popover absolute z-10 mt-2 grid w-64 gap-3 rounded-xl border p-3 shadow-lg">
            <label className="grid gap-1 text-sm font-medium">
              Country
              <select
                className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any country</option>
                {(countries.data?.items ?? []).map((item) => (
                  <option key={item.iso2} value={item.iso2}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Opt-out
              <select
                className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
                value={optedOut}
                onChange={(event) => {
                  setOptedOut(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any</option>
                <option value="yes">Opted out</option>
                <option value="no">Can be contacted</option>
              </select>
            </label>
          </div>
        </details>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Country</th>
              <SortHeading
                label="Phone"
                active={sort === 'phone'}
                onClick={() => {
                  sortBy('phone');
                }}
              />
              <SortHeading
                label="Name"
                active={sort === 'name'}
                onClick={() => {
                  sortBy('name');
                }}
              />
              <th className="px-3 py-2 font-medium">Opt-out</th>
              <SortHeading
                label="Created"
                active={sort === 'createdAt'}
                onClick={() => {
                  sortBy('createdAt');
                }}
              />
            </tr>
          </thead>
          <tbody>
            {list.isPending ? (
              <SkeletonRows />
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-3 py-8" colSpan={6}>
                  <div className="grid justify-items-start gap-3">
                    <p className="font-medium">No contacts yet</p>
                    <p className="text-muted-foreground">
                      Add a number, or import a CSV, to start a list.
                    </p>
                    {canMessage ? (
                      <Button
                        type="button"
                        onClick={() => {
                          setCreating(true);
                        }}
                      >
                        Create contact
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-muted/40 cursor-pointer border-t"
                  onClick={() => {
                    setOpenId(row.id);
                  }}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.shortId}</td>
                  <td className="px-3 py-2">
                    {flag(row.countryCode)} {row.countryCode}
                    {dials.get(row.countryCode) === undefined
                      ? ''
                      : ` +${dials.get(row.countryCode) ?? ''}`}
                  </td>
                  <td className="px-3 py-2">{row.phoneE164}</td>
                  <td className="px-3 py-2">{row.name ?? '—'}</td>
                  <td className="px-3 py-2">{row.optedOut ? 'Opted out' : 'No'}</td>
                  <td className="px-3 py-2">{row.createdAt.slice(0, 10)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{showing(total, page, pageSize)}</p>
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      {creating ? (
        <CreateContact
          countries={countries.data?.items ?? []}
          onClose={() => {
            setCreating(false);
          }}
          onCreated={async (message, close) => {
            toast(message);
            if (close) {
              setCreating(false);
            }
            await queryClient.invalidateQueries({ queryKey: ['contacts'] });
          }}
        />
      ) : null}
      {openId === null ? null : (
        <ContactDrawer
          detail={detail.data}
          pending={detail.isPending}
          canDelete={canMessage}
          onClose={() => {
            setOpenId(null);
          }}
          onDelete={() => {
            if (detail.data !== undefined) {
              setPendingDelete(detail.data);
            }
          }}
        />
      )}
      {pendingDelete === null ? null : (
        <ConfirmDialog
          title="Delete contact"
          confirmLabel="Delete"
          pending={busy}
          onCancel={() => {
            setPendingDelete(null);
          }}
          onConfirm={() => {
            void remove(pendingDelete);
          }}
        >
          {pendingDelete.name ?? pendingDelete.phoneE164} will be removed from this organization.
        </ConfirmDialog>
      )}
    </section>
  );
}

function SortHeading({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2 font-medium">
      <button type="button" className="hover:underline" onClick={onClick}>
        {label}
        {active ? ' ↓' : ''}
      </button>
    </th>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <tr key={row} className="border-t">
          <td className="px-3 py-3" colSpan={6}>
            <div className="bg-muted h-4 animate-pulse rounded" />
          </td>
        </tr>
      ))}
    </>
  );
}

function CreateContact({
  countries,
  onClose,
  onCreated,
}: {
  countries: { iso2: string; name: string }[];
  onClose: () => void;
  onCreated: (message: string, close: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'single' | 'csv'>('single');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [csv, setCsv] = useState('phone,name,country\n+14155552671,Ada,US');
  const [hasHeader, setHasHeader] = useState(true);
  const [phoneColumn, setPhoneColumn] = useState(0);
  const [nameColumn, setNameColumn] = useState('1');
  const [countryColumn, setCountryColumn] = useState('2');
  const [pending, setPending] = useState(false);
  const [rejectCsv, setRejectCsv] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFieldError(null);
    try {
      if (mode === 'single') {
        await catalogApi.createContact({
          phone,
          name,
          ...(country === '' ? {} : { country }),
        });
        await onCreated('Contact created.', true);
        return;
      }
      const result = await catalogApi.importContacts({
        csv,
        hasHeader,
        phoneColumn,
        nameColumn: nameColumn === '' ? null : Number(nameColumn),
        countryColumn: countryColumn === '' ? null : Number(countryColumn),
      });
      setRejectCsv(result.rejected.length === 0 ? null : result.rejectCsv);
      const close = result.rejected.length === 0;
      await onCreated(
        `Imported ${String(result.created)}. Rejected ${String(result.rejected.length)}.`,
        close,
      );
      if (!close) {
        setPending(false);
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not save that contact.';
      setFieldError(
        error instanceof ApiError ? (error.fields.phone ?? error.fields.csv ?? message) : message,
      );
      toast(message);
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <form
        className="bg-popover text-popover-foreground grid max-h-[90dvh] w-full max-w-lg gap-4 overflow-auto rounded-xl border p-5 shadow-xl"
        role="dialog"
        aria-labelledby="create-contact-title"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <h2 id="create-contact-title" className="text-lg font-semibold">
          Create contact
        </h2>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'single' ? 'default' : 'outline'}
            onClick={() => {
              setMode('single');
            }}
          >
            One number
          </Button>
          <Button
            type="button"
            variant={mode === 'csv' ? 'default' : 'outline'}
            onClick={() => {
              setMode('csv');
            }}
          >
            CSV
          </Button>
        </div>
        {mode === 'single' ? (
          <>
            <label className="grid gap-1 text-sm font-medium">
              Phone
              <input
                className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
                required
                value={phone}
                aria-invalid={fieldError !== null}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Name
              <input
                className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Country
              <select
                className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value);
                }}
              >
                <option value="">Detect from the number</option>
                {countries.map((item) => (
                  <option key={item.iso2} value={item.iso2}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="grid gap-1 text-sm font-medium">
              CSV
              <textarea
                className="border-input bg-background min-h-28 rounded-lg border p-3 font-mono text-xs font-normal"
                required
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(event) => {
                  setHasHeader(event.target.checked);
                }}
              />
              First row is a header
            </label>
            <div className="grid grid-cols-3 gap-2">
              <ColumnField
                label="Phone column"
                value={String(phoneColumn)}
                onChange={(value) => {
                  setPhoneColumn(Number(value));
                }}
              />
              <ColumnField
                label="Name column"
                value={nameColumn}
                onChange={setNameColumn}
                optional
              />
              <ColumnField
                label="Country column"
                value={countryColumn}
                onChange={setCountryColumn}
                optional
              />
            </div>
            {rejectCsv === null ? null : (
              <a
                className="text-sm font-medium underline"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(rejectCsv)}`}
                download="contact-rejects.csv"
              >
                Download reject report
              </a>
            )}
          </>
        )}
        {fieldError === null ? null : <p className="text-destructive text-sm">{fieldError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

function ColumnField({
  label,
  value,
  optional,
  onChange,
}: {
  label: string;
  value: string;
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
        inputMode="numeric"
        value={value}
        placeholder={optional === true ? '—' : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function ContactDrawer({
  detail,
  pending,
  canDelete,
  onClose,
  onDelete,
}: {
  detail: ContactDetail | undefined;
  pending: boolean;
  canDelete: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="bg-background h-full w-full max-w-md overflow-auto border-l p-5"
        role="dialog"
        aria-label="Contact"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {pending || detail === undefined ? (
          <div className="bg-muted h-24 animate-pulse rounded-xl" />
        ) : (
          <div className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{detail.name ?? 'Unnamed contact'}</h2>
                <p className="text-muted-foreground text-sm">{detail.phoneE164}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(detail.id).then(() => {
                    toast('Contact ID copied.');
                  });
                }}
              >
                Copy ID
              </Button>
            </div>
            <p className="text-sm">
              {flag(detail.countryCode)} {detail.countryCode}
              {detail.optedOut ? ' · Opted out' : ' · Can be contacted'}
            </p>
            <div>
              <h3 className="font-medium">Message history</h3>
              {detail.messages.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  No messages to this number yet.
                </p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {detail.messages.map((message) => (
                    <li key={message.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{message.status}</p>
                      <p className="mt-1 break-words whitespace-pre-wrap">{message.body}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{message.createdAt}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canDelete ? (
              <Button type="button" variant="destructive" onClick={onDelete}>
                Delete contact
              </Button>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  );
}
