'use client';

import { useQuery } from '@tanstack/react-query';
import { type SubmitEvent, useState } from 'react';

import { flag } from '@/components/catalog/table-tools';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { catalogApi, type PhoneLookup } from '@/lib/catalog';

export default function NumberLookupPage() {
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => catalogApi.countries() });
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhoneLookup | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setResult(
        await catalogApi.lookup({
          phone,
          ...(country === '' ? {} : { country }),
        }),
      );
    } catch (caught) {
      setResult(null);
      setError(caught instanceof ApiError ? caught.message : 'Lookup failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Number lookup</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Check a number offline. Nothing is sent to a carrier.
        </p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label className="grid gap-1 text-sm font-medium">
          Country
          <select
            className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
            value={country}
            onChange={(event) => {
              setCountry(event.target.value);
            }}
          >
            <option value="">Any</option>
            {(countries.data?.items ?? []).map((item) => (
              <option key={item.iso2} value={item.iso2}>
                {flag(item.iso2)} {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Number
          <input
            className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
            required
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </label>
        <Button type="submit" disabled={pending}>
          Look up
        </Button>
      </form>
      {error === null ? null : <p className="text-destructive text-sm">{error}</p>}
      {result === null ? null : <LookupResult result={result} />}
    </section>
  );
}

function LookupResult({ result }: { result: PhoneLookup }) {
  if (!result.valid) {
    return <p className="rounded-2xl border p-4 text-sm">That number is not valid.</p>;
  }
  const rows = [
    ['E.164', result.e164],
    ['International', result.international],
    ['National', result.national],
    ['Country', result.countryName],
    ['Region', result.region],
    ['Type', result.type],
    ['Time zones', result.timeZones.join(', ')],
  ] as const;
  return (
    <dl className="grid gap-3 rounded-2xl border p-4 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[9rem_1fr] gap-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value === null || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}
