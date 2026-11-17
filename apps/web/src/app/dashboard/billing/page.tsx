'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';

import { PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { useCanBilling } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { downloadReceipt, insightApi, type BillingPreferences } from '@/lib/billing';

const TABS = ['Overview', 'Payment methods', 'History', 'Preferences'] as const;
const PRESETS = ['10.00', '25.00', '50.00', '100.00'];

export default function BillingPage() {
  const canBill = useCanBilling();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  if (!canBill) {
    return <p className="text-muted-foreground text-sm">Billing is limited to billing roles.</p>;
  }
  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Prepaid USD balance. Card numbers are never stored here.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Button
            key={item}
            type="button"
            variant={tab === item ? 'default' : 'outline'}
            onClick={() => {
              setTab(item);
            }}
          >
            {item}
          </Button>
        ))}
      </div>
      {tab === 'Overview' ? <OverviewTab /> : null}
      {tab === 'Payment methods' ? <MethodsTab /> : null}
      {tab === 'History' ? <HistoryTab /> : null}
      {tab === 'Preferences' ? <PreferencesTab /> : null}
    </section>
  );
}

function OverviewTab() {
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => insightApi.billing() });
  const toast = useToast();
  const [amount, setAmount] = useState('25.00');
  const [pending, setPending] = useState(false);

  async function addCredit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await insightApi.topUp(amount);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That top-up could not be started.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="bg-card rounded-[18px] border p-5 shadow-sm">
        <p className="text-muted-foreground text-sm">Available</p>
        <p className="text-3xl font-bold">{billing.data?.balance.available.display ?? '—'} USD</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Held {billing.data?.balance.held.display ?? '—'} USD
        </p>
      </div>
      <form
        className="bg-card grid max-w-lg gap-3 rounded-[18px] border p-5 shadow-sm"
        onSubmit={(event) => void addCredit(event)}
      >
        <h2 className="font-semibold">Add credit</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant={amount === preset ? 'default' : 'outline'}
              onClick={() => {
                setAmount(preset);
              }}
            >
              {preset} USD
            </Button>
          ))}
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Custom amount
          <input
            className="border-input h-10 rounded-lg border px-3 font-normal"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </label>
        <Button type="submit" disabled={pending}>
          Continue to checkout
        </Button>
        <p className="text-muted-foreground text-sm">
          Minimum 10 USD. Checkout stays closed until a payment provider is connected, and a refused
          checkout does not credit the balance.
          {billing.data?.autoRecharge === 'below_threshold'
            ? ' Auto-recharge is below its threshold and is not charged.'
            : ''}
        </p>
      </form>
    </div>
  );
}

function MethodsTab() {
  return (
    <div className="bg-card max-w-lg rounded-[18px] border p-5 shadow-sm">
      <h2 className="font-semibold">Payment methods</h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Saved cards are managed on the provider&apos;s hosted page. No provider is connected, so
        there is no page to open and no card data is stored.
      </p>
    </div>
  );
}

function HistoryTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const history = useQuery({
    queryKey: ['ledger', page, pageSize],
    queryFn: () => insightApi.history(`?page=${String(page)}&pageSize=${String(pageSize)}`),
  });
  const total = history.data?.total ?? 0;
  const toast = useToast();

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">ID</th>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Amount</th>
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {(history.data?.items ?? []).map((item) => (
              <tr key={item.id} className="border-border border-t">
                <td className="py-2 font-mono text-xs">{item.id.slice(0, 8)}</td>
                <td className="py-2">{item.description}</td>
                <td className="py-2">{item.status}</td>
                <td className="py-2 font-mono text-xs">{item.amount.display}</td>
                <td className="py-2">{item.createdAt.slice(0, 10)}</td>
                <td className="py-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void downloadReceipt(item.id).catch((error: unknown) => {
                        toast(error instanceof ApiError ? error.message : 'Download failed.');
                      });
                    }}
                  >
                    Download
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{showing(total, page, pageSize)}</p>
        <PageSize
          value={pageSize}
          onChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
        <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} onPage={setPage} />
      </div>
    </div>
  );
}

function PreferencesTab() {
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => insightApi.billing() });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<BillingPreferences | null>(null);
  const values = form ?? billing.data?.preferences ?? null;
  const [pending, setPending] = useState(false);
  if (values === null) {
    return <div className="bg-muted h-40 animate-pulse rounded-2xl" />;
  }
  const current = values;

  function set<K extends keyof BillingPreferences>(key: K, value: BillingPreferences[K]) {
    setForm({ ...current, [key]: value });
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await insightApi.saveBilling(current);
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      toast('Billing preferences saved.');
      setForm(null);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Those preferences could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid max-w-lg gap-3" onSubmit={(event) => void save(event)}>
      <Field
        label="Billing email"
        value={values.email}
        onChange={(value) => {
          set('email', value);
        }}
      />
      <Field
        label="Name"
        value={values.name}
        onChange={(value) => {
          set('name', value);
        }}
      />
      <Field
        label="Address"
        value={values.line1}
        onChange={(value) => {
          set('line1', value);
        }}
      />
      <Field
        label="Address line 2"
        value={values.line2}
        onChange={(value) => {
          set('line2', value);
        }}
      />
      <Field
        label="City"
        value={values.city}
        onChange={(value) => {
          set('city', value);
        }}
      />
      <Field
        label="Region"
        value={values.region}
        onChange={(value) => {
          set('region', value);
        }}
      />
      <Field
        label="Postal code"
        value={values.postalCode}
        onChange={(value) => {
          set('postalCode', value);
        }}
      />
      <Field
        label="Country"
        value={values.countryIso2}
        onChange={(value) => {
          set('countryIso2', value);
        }}
      />
      <Field
        label="Low-balance email at (USD)"
        value={values.lowBalance}
        onChange={(value) => {
          set('lowBalance', value);
        }}
      />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={values.autoRechargeEnabled}
          onChange={(event) => {
            set('autoRechargeEnabled', event.target.checked);
          }}
        />
        Auto-recharge
      </label>
      <Field
        label="When available falls below (USD)"
        value={values.autoRechargeThreshold}
        onChange={(value) => {
          set('autoRechargeThreshold', value);
        }}
      />
      <Field
        label="Recharge amount (USD)"
        value={values.autoRechargeAmount}
        onChange={(value) => {
          set('autoRechargeAmount', value);
        }}
      />
      <p className="text-muted-foreground text-sm">
        The threshold and amount are saved. Nothing is charged until a payment provider is
        connected.
      </p>
      <Button type="submit" disabled={pending}>
        Save preferences
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="border-input h-10 rounded-lg border px-3 font-normal"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}
