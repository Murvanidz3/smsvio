'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { adminApi, formText, type AdminRoute } from '@/lib/admin';
import { ApiError } from '@/lib/api';

const field = 'border-input bg-background h-9 w-full rounded-lg border px-3 text-sm';

export default function RoutesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<AdminRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
  const routes = useQuery({
    queryKey: ['admin-routes', query.toString()],
    queryFn: () => adminApi.routes(`?${query.toString()}`),
  });
  const providers = useQuery({
    queryKey: ['admin-providers'],
    queryFn: () => adminApi.providers(),
  });
  const countries = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => adminApi.countries(),
  });
  const total = routes.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Routes</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Customer price is the route cost plus the markup in effect, rounded up to 0.0001 USD. A
          route markup replaces the provider markup.
        </p>
      </div>
      <form
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const network = formText(form, 'network').trim();
          const markup = formText(form, 'markup').trim();
          setBusy(true);
          void adminApi
            .createRoute({
              countryIso2: formText(form, 'country'),
              mccmnc: network === '' ? null : network,
              providerId: formText(form, 'provider'),
              priority: Number(formText(form, 'priority')),
              weight: Number(formText(form, 'weight')),
              cost: formText(form, 'cost'),
              markupPercent: markup === '' ? null : Number(markup),
              enabled: true,
            })
            .then(async (result) => {
              toast(result.message);
              formElement.reset();
              await queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
            })
            .catch((error: unknown) => {
              toast(error instanceof ApiError ? error.message : 'Could not save that route.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <label className="grid gap-1 text-sm">
          Country
          <select className={field} name="country" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {(countries.data?.items ?? []).map((country) => (
              <option key={country.iso2} value={country.iso2}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Provider
          <select className={field} name="provider" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {(providers.data?.items ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.code}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Network
          <input className={field} name="network" placeholder="Country-wide" />
        </label>
        <label className="grid gap-1 text-sm">
          Cost (USD)
          <input className={field} name="cost" inputMode="decimal" required defaultValue="0.0100" />
        </label>
        <label className="grid gap-1 text-sm">
          Priority
          <input
            className={field}
            name="priority"
            type="number"
            min={1}
            required
            defaultValue={100}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Weight
          <input className={field} name="weight" type="number" min={1} required defaultValue={1} />
        </label>
        <label className="grid gap-1 text-sm">
          Markup override %
          <input className={field} name="markup" type="number" min={0} max={1000} />
        </label>
        <Button type="submit" disabled={busy} className="self-end">
          Add route
        </Button>
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
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">Destination</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Markup</th>
              <th className="px-3 py-2 font-medium">Customer price</th>
              <th className="px-3 py-2 font-medium">Margin</th>
              <th className="px-3 py-2 font-medium">List price</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(routes.data?.items.length ?? 0) === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={9}>
                  No routes match that search.
                </td>
              </tr>
            ) : (
              routes.data?.items.map((route) => (
                <tr key={route.id} className="border-t">
                  <td className="px-3 py-2">
                    {route.countryName}
                    {route.mccmnc === null ? '' : ` ${route.mccmnc}`}
                    {route.enabled ? '' : ' · disabled'}
                  </td>
                  <td className="px-3 py-2">{route.providerCode}</td>
                  <td className="px-3 py-2">{route.priority}</td>
                  <td className="px-3 py-2">{route.cost.display}</td>
                  <td className="px-3 py-2">
                    {route.markupPercent === null
                      ? '—'
                      : `${String(route.markupPercent)}% ${route.markupSource ?? ''}`}
                  </td>
                  <td className="px-3 py-2">{route.price?.display ?? '—'}</td>
                  <td className="px-3 py-2">{route.margin?.display ?? '—'}</td>
                  <td className="px-3 py-2">{route.setsListPrice ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditing(route);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
      {editing === null ? null : (
        <EditRoute
          route={editing}
          busy={busy}
          onCancel={() => {
            setEditing(null);
          }}
          onSubmit={async (body) => {
            setBusy(true);
            try {
              const result = await adminApi.updateRoute(editing.id, body);
              toast(result.message);
              setEditing(null);
              await queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'Could not update that route.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

function EditRoute({
  route,
  busy,
  onCancel,
  onSubmit,
}: {
  route: AdminRoute;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    priority: number;
    weight: number;
    cost: string;
    markupPercent: number | null;
    enabled: boolean;
  }) => Promise<void>;
}) {
  const [priority, setPriority] = useState(String(route.priority));
  const [weight, setWeight] = useState(String(route.weight));
  const [cost, setCost] = useState(route.cost.display);
  const [markup, setMarkup] = useState(
    route.markupSource === 'route' ? String(route.markupPercent ?? '') : '',
  );
  const [enabled, setEnabled] = useState(route.enabled);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <form
        className="bg-popover w-full max-w-md rounded-xl border p-5"
        role="dialog"
        aria-labelledby="edit-route-title"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            priority: Number(priority),
            weight: Number(weight),
            cost,
            markupPercent: markup.trim() === '' ? null : Number(markup),
            enabled,
          });
        }}
      >
        <h2 id="edit-route-title" className="text-lg font-semibold">
          Edit {route.countryName}
        </h2>
        <label className="mt-4 grid gap-1 text-sm">
          Priority
          <input
            className={field}
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
            }}
            required
          />
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Weight
          <input
            className={field}
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value);
            }}
            required
          />
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Cost (USD)
          <input
            className={field}
            value={cost}
            onChange={(event) => {
              setCost(event.target.value);
            }}
            required
          />
        </label>
        <label className="mt-3 grid gap-1 text-sm">
          Markup override %
          <input
            className={field}
            value={markup}
            onChange={(event) => {
              setMarkup(event.target.value);
            }}
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
            }}
          />
          Enabled
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save route
          </Button>
        </div>
      </form>
    </div>
  );
}
