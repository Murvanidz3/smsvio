'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { adminApi, formText } from '@/lib/admin';
import { ApiError } from '@/lib/api';

const field = 'border-input bg-background h-9 w-full rounded-lg border px-3 text-sm';

export default function RatesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [csv, setCsv] = useState('country,network,price\n');
  const [busy, setBusy] = useState(false);
  const organizations = useQuery({
    queryKey: ['admin-organizations', 'picker'],
    queryFn: () => adminApi.organizations('?page=1&pageSize=100'),
  });
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
    ...(organizationId === '' ? {} : { organizationId }),
  });
  const rates = useQuery({
    queryKey: ['admin-rates', query.toString()],
    queryFn: () => adminApi.rates(`?${query.toString()}`),
  });
  const total = rates.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rates</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A per-customer price wins, then a manual country price, then the price computed from the
          primary route.
        </p>
      </div>
      <form
        className="grid gap-3 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          setBusy(true);
          void adminApi
            .orgRate({
              organizationId: formText(form, 'organization'),
              countryIso2: formText(form, 'country').toUpperCase(),
              mccmnc: null,
              price: formText(form, 'price'),
            })
            .then(async (result) => {
              toast(result.message);
              formElement.reset();
              await queryClient.invalidateQueries({ queryKey: ['admin-rates'] });
            })
            .catch((error: unknown) => {
              toast(error instanceof ApiError ? error.message : 'Could not save that price.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <h2 className="font-medium">Per-customer price</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="grid gap-1 text-sm">
            Organization
            <select className={field} name="organization" required defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {(organizations.data?.items ?? []).map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Country
            <input className={field} name="country" required maxLength={2} placeholder="DE" />
          </label>
          <label className="grid gap-1 text-sm">
            Price (USD)
            <input className={field} name="price" inputMode="decimal" required />
          </label>
          <Button type="submit" disabled={busy} className="self-end">
            Save price
          </Button>
        </div>
      </form>
      <form
        className="grid gap-3 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void adminApi
            .previewRates(csv)
            .then((result) => {
              if (!result.ok) {
                toast(result.errors?.[0]?.message ?? 'That file has errors.');
                return;
              }
              return adminApi.importRates(csv);
            })
            .then(async (result) => {
              if (result === undefined) {
                return;
              }
              toast(result.message);
              await queryClient.invalidateQueries({ queryKey: ['admin-rates'] });
            })
            .catch((error: unknown) => {
              toast(error instanceof ApiError ? error.message : 'Could not import those prices.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <label className="grid gap-1 text-sm">
          Manual prices (CSV)
          <textarea
            className="border-input bg-background min-h-28 w-full rounded-lg border px-3 py-2 font-mono text-sm"
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
            }}
          />
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void adminApi
                .previewRates(csv)
                .then((result) => {
                  toast(
                    result.ok
                      ? `${String(result.rows?.length ?? 0)} prices are ready to import.`
                      : (result.errors?.[0]?.message ?? 'That file has errors.'),
                  );
                })
                .catch((error: unknown) => {
                  toast(error instanceof ApiError ? error.message : 'Could not preview that file.');
                });
            }}
          >
            Preview
          </Button>
          <Button type="submit" disabled={busy}>
            Import
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-end justify-between gap-3">
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
        <label className="grid gap-1 text-sm">
          Show prices for
          <select
            className={field}
            value={organizationId}
            onChange={(event) => {
              setOrganizationId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">List prices</option>
            {(organizations.data?.items ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
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
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">Destination</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {(rates.data?.items.length ?? 0) === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={3}>
                  No rates match that search.
                </td>
              </tr>
            ) : (
              rates.data?.items.map((rate) => (
                <tr key={`${rate.countryIso2}:${rate.mccmnc ?? ''}`} className="border-t">
                  <td className="px-3 py-2">
                    {rate.countryName}
                    {rate.mccmnc === null ? '' : ` ${rate.mccmnc}`}
                  </td>
                  <td className="px-3 py-2">{rate.price?.display ?? '—'}</td>
                  <td className="px-3 py-2">{rate.source ?? 'none'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </section>
  );
}
