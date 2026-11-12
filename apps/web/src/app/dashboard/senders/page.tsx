'use client';

import { roleAllows } from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ConfirmDialog } from '@/components/catalog/confirm';
import { flag } from '@/components/catalog/table-tools';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';
import { senderApi, type SenderDestination } from '@/lib/senders';

const field = 'border-input bg-background h-9 w-full rounded-lg border px-3 text-sm';

export default function SendersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const role = session.data?.organization?.role;
  const canEdit = role !== undefined && roleAllows(role, 'compliance');
  const actionReason = !session.isSuccess
    ? 'Checking your role.'
    : session.data.organization === null
      ? 'Join an organization to change senders.'
      : 'Only an owner or admin can change senders.';
  const overview = useQuery({ queryKey: ['senders'], queryFn: () => senderApi.overview() });
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [country, setCountry] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  const [remove, setRemove] = useState<SenderDestination | null>(null);
  const [busy, setBusy] = useState(false);
  const destinations = overview.data?.destinations ?? [];
  const enabled = destinations.filter((row) => row.enabled);
  const available = destinations.filter((row) => !row.enabled);
  const needle = countryQuery.trim().toLowerCase();
  const countryMatches = available
    .filter(
      (row) =>
        needle === '' ||
        row.name.toLowerCase().includes(needle) ||
        row.iso2.toLowerCase().includes(needle),
    )
    .slice(0, 8);
  const emptyReason = overview.isPending
    ? 'Countries are still loading.'
    : overview.isError
      ? 'Countries could not be loaded.'
      : destinations.length === 0
        ? 'No countries are in the directory yet. They are loaded when the platform is deployed.'
        : available.length === 0
          ? 'Every country is already enabled.'
          : 'No country matches that search.';
  const sharedSender = overview.data?.platformSender?.value;

  async function addCountry() {
    setBusy(true);
    try {
      const result = await senderApi.addCountry({ countryIso2: country, senderId: null });
      toast(result.message);
      setAdding(false);
      setCountry('');
      setCountryQuery('');
      await queryClient.invalidateQueries({ queryKey: ['senders'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not enable that country.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (remove?.orgCountryId === null || remove?.orgCountryId === undefined) {
      return;
    }
    setBusy(true);
    try {
      const result = await senderApi.removeCountry(remove.orgCountryId);
      toast(result.message);
      setRemove(null);
      await queryClient.invalidateQueries({ queryKey: ['senders'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not remove that country.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Senders</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Choose the countries you send to and the sender customers see.
            {sharedSender === undefined || sharedSender === ''
              ? null
              : ` The shared number is ${sharedSender}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <span title={canEdit ? undefined : actionReason} className="inline-flex">
            <Button
              type="button"
              variant="outline"
              disabled={!canEdit}
              onClick={() => {
                setRequesting(true);
              }}
            >
              Request sender ID
            </Button>
          </span>
          <span title={canEdit ? undefined : actionReason} className="inline-flex">
            <Button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setAdding(true);
              }}
            >
              Add country
            </Button>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">Country</th>
              <th className="px-3 py-2 font-medium">Sender</th>
              <th className="px-3 py-2 font-medium">Price / segment</th>
              <th className="px-3 py-2 font-medium">Registration</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {enabled.length === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={5}>
                  No countries are enabled yet.
                </td>
              </tr>
            ) : (
              enabled.map((row) => (
                <tr key={row.iso2} className="border-t">
                  <td className="px-3 py-2">
                    {flag(row.iso2)} {row.name}
                  </td>
                  <td className="px-3 py-2">{row.sender?.value ?? '—'}</td>
                  <td className="px-3 py-2">
                    {row.price === null ? 'No price' : `${row.price.display} USD`}
                  </td>
                  <td className="px-3 py-2">
                    {row.registrationRequired
                      ? row.registrationComplete
                        ? 'Complete'
                        : 'Required'
                      : 'Not required'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setRemove(row);
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">Requested sender</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Countries</th>
            </tr>
          </thead>
          <tbody>
            {(overview.data?.senderIds.length ?? 0) === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={4}>
                  No sender requests yet. Requests stay pending until an operator reviews them.
                </td>
              </tr>
            ) : (
              overview.data?.senderIds.map((sender) => (
                <tr key={sender.id} className="border-t">
                  <td className="px-3 py-2">{sender.value}</td>
                  <td className="px-3 py-2">{sender.type}</td>
                  <td className="px-3 py-2">{sender.status}</td>
                  <td className="px-3 py-2">{sender.countries.join(', ')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {adding
        ? createPortal(
            <AddCountryDialog
              country={country}
              countryQuery={countryQuery}
              countryMatches={countryMatches}
              emptyReason={countryMatches.length === 0 ? emptyReason : null}
              busy={busy}
              onQuery={(value) => {
                setCountryQuery(value);
                setCountry('');
              }}
              onPick={(iso2, name) => {
                setCountry(iso2);
                setCountryQuery(name);
              }}
              onCancel={() => {
                setAdding(false);
              }}
              onEnable={() => void addCountry()}
            />,
            document.body,
          )
        : null}
      {requesting ? (
        <RequestSender
          countries={enabled}
          busy={busy}
          onCancel={() => {
            setRequesting(false);
          }}
          onSubmit={async (body) => {
            setBusy(true);
            try {
              const result = await senderApi.requestSender(body);
              toast(result.message);
              setRequesting(false);
              await queryClient.invalidateQueries({ queryKey: ['senders'] });
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'Could not submit that request.');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {remove !== null ? (
        <ConfirmDialog
          title={`Remove ${remove.name}?`}
          confirmLabel="Remove country"
          pending={busy}
          onCancel={() => {
            setRemove(null);
          }}
          onConfirm={() => {
            void confirmRemove();
          }}
        >
          Sending to {remove.name} stops until you enable it again.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function RequestSender({
  countries,
  busy,
  onCancel,
  onSubmit,
}: {
  countries: SenderDestination[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    type: string;
    value: string;
    useCase: string;
    countries: string[];
  }) => Promise<void>;
}) {
  const [type, setType] = useState('ALPHANUMERIC');
  const [value, setValue] = useState('');
  const [useCase, setUseCase] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <form
        className="bg-popover w-full max-w-md rounded-xl border p-5"
        role="dialog"
        aria-labelledby="request-sender-title"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ type, value, useCase, countries: selected });
        }}
      >
        <h2 id="request-sender-title" className="text-lg font-semibold">
          Request a sender ID
        </h2>
        {countries.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Enable a country before requesting a sender ID.
          </p>
        ) : null}
        <label className="mt-4 grid gap-1 text-sm">
          Type
          <select
            className={field}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
          >
            <option value="ALPHANUMERIC">Alphanumeric</option>
            <option value="LONG_CODE">Long code</option>
            <option value="SHORT_CODE">Short code</option>
          </select>
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Sender
          <input
            className={field}
            value={value}
            maxLength={15}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            required
          />
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Use case
          <textarea
            className="border-input bg-background min-h-24 w-full rounded-lg border px-3 py-2 text-sm"
            value={useCase}
            minLength={10}
            maxLength={500}
            onChange={(event) => {
              setUseCase(event.target.value);
            }}
            required
          />
        </label>
        <fieldset className="mt-3 grid max-h-40 gap-1 overflow-y-auto text-sm">
          <legend>Countries</legend>
          {countries.map((row) => (
            <label key={row.iso2} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(row.iso2)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, row.iso2]
                      : current.filter((iso) => iso !== row.iso2),
                  );
                }}
              />
              {row.name}
            </label>
          ))}
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || selected.length === 0}>
            Submit request
          </Button>
        </div>
      </form>
    </div>
  );
}

function AddCountryDialog({
  country,
  countryQuery,
  countryMatches,
  emptyReason,
  busy,
  onQuery,
  onPick,
  onCancel,
  onEnable,
}: {
  country: string;
  countryQuery: string;
  countryMatches: SenderDestination[];
  emptyReason: string | null;
  busy: boolean;
  onQuery: (value: string) => void;
  onPick: (iso2: string, name: string) => void;
  onCancel: () => void;
  onEnable: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="add-country-title"
      className="bg-popover m-auto w-[min(100%-2rem,28rem)] max-w-md rounded-xl border p-5 backdrop:bg-black/40"
      style={{ overflow: 'visible' }}
    >
      <h2 id="add-country-title" className="text-lg font-semibold">
        Add a country
      </h2>
      <label className="mt-4 grid gap-1 text-sm">
        Country
        <input
          className={field}
          value={countryQuery}
          onChange={(event) => {
            onQuery(event.target.value);
          }}
        />
      </label>
      <ul
        className="mt-2 grid max-h-24 gap-1 overflow-y-auto overscroll-contain"
        role="listbox"
        aria-label="Matching countries"
      >
        {countryMatches.length === 0 ? (
          <li className="text-muted-foreground px-3 py-2 text-sm">{emptyReason}</li>
        ) : (
          countryMatches.map((row) => (
            <li key={row.iso2}>
              <button
                type="button"
                role="option"
                aria-selected={country === row.iso2}
                className="hover:bg-muted w-full rounded-lg px-3 py-2 text-left text-sm"
                onClick={() => {
                  onPick(row.iso2, row.name);
                }}
              >
                {row.name} +{row.dialCode}
                {row.price === null ? '' : ` · ${row.price.display} USD`}
              </button>
            </li>
          ))
        )}
      </ul>
      <p className="text-muted-foreground mt-3 text-sm">
        New countries use the shared platform number until you have an approved sender.
      </p>
      <div className="mt-5 grid gap-2">
        <Button
          type="button"
          style={{ height: '3rem', width: '100%', pointerEvents: 'auto' }}
          disabled={busy || country === ''}
          onClick={onEnable}
        >
          Enable country
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
