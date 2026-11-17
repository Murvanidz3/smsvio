'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { complianceApi } from '@/lib/compliance';

const TABS = ['Business', 'Use cases', 'Documents', 'Auto-replies'] as const;
const field = 'border-input h-10 rounded-lg border px-3 text-sm font-normal';

export default function CompliancePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Business');
  const view = useQuery({ queryKey: ['compliance'], queryFn: () => complianceApi.view() });
  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Compliance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Status {view.data?.status ?? '…'}. Sending stays limited to your verified phone until an
          operator approves the business. Opt-out keywords are kept even if the contact is deleted,
          and a country must be enabled before it can receive traffic.
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
      {tab === 'Business' ? <Business /> : null}
      {tab === 'Use cases' ? <UseCases /> : null}
      {tab === 'Documents' ? <Documents /> : null}
      {tab === 'Auto-replies' ? <Replies /> : null}
    </section>
  );
}

function Business() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: ['compliance'], queryFn: () => complianceApi.view() });
  const profile = view.data?.profile ?? null;
  const [legalName, setLegalName] = useState('');
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState('GE');
  const rejected =
    profile !== null && profile.reviewNote !== '' && view.data?.status === 'PENDING_VERIFICATION';
  if (profile !== null && !rejected) {
    return (
      <div className="bg-card max-w-xl rounded-[18px] border p-5 text-sm">
        <p className="font-semibold">{profile.legalName}</p>
        <p className="mt-2">{profile.address}</p>
        <p className="text-muted-foreground mt-2">
          {profile.registrationCountry} · submitted {profile.submittedAt}
        </p>
        {profile.reviewNote === '' ? null : <p className="mt-2">{profile.reviewNote}</p>}
      </div>
    );
  }
  return (
    <form
      className="bg-card grid max-w-xl gap-3 rounded-[18px] border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void complianceApi
          .business({
            legalName,
            address,
            website: '',
            registrationNumber: '',
            registrationCountry: country,
          })
          .then(async () => {
            toast('Verification submitted.');
            await queryClient.invalidateQueries({ queryKey: ['compliance'] });
          })
          .catch((error: unknown) => {
            toast(error instanceof ApiError ? error.message : 'Could not submit verification.');
          });
      }}
    >
      <label className="grid gap-1 text-sm font-medium">
        Legal name
        <input
          className={field}
          required
          value={legalName}
          onChange={(event) => {
            setLegalName(event.target.value);
          }}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Address
        <input
          className={field}
          required
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Country
        <input
          className={field}
          maxLength={2}
          required
          value={country}
          onChange={(event) => {
            setCountry(event.target.value.toUpperCase());
          }}
        />
      </label>
      <Button type="submit">Submit for review</Button>
    </form>
  );
}

function UseCases() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: ['compliance'], queryFn: () => complianceApi.view() });
  const [purpose, setPurpose] = useState('');
  const [sample, setSample] = useState('');
  const [optIn, setOptIn] = useState('');
  return (
    <div className="grid max-w-xl gap-4">
      {(view.data?.useCases ?? []).map((item) => (
        <p key={item.id} className="text-sm">
          {item.status}: {item.purpose}
        </p>
      ))}
      <form
        className="bg-card grid gap-3 rounded-[18px] border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void complianceApi
            .useCase({ purpose, sample, optIn })
            .then(async () => {
              toast('Use case submitted.');
              await queryClient.invalidateQueries({ queryKey: ['compliance'] });
            })
            .catch((error: unknown) => {
              toast(error instanceof ApiError ? error.message : 'Could not save the use case.');
            });
        }}
      >
        <textarea
          className={`${field} h-20 py-2`}
          required
          value={purpose}
          onChange={(event) => {
            setPurpose(event.target.value);
          }}
          placeholder="What you send"
        />
        <textarea
          className={`${field} h-20 py-2`}
          required
          value={sample}
          onChange={(event) => {
            setSample(event.target.value);
          }}
          placeholder="Sample message"
        />
        <textarea
          className={`${field} h-20 py-2`}
          required
          value={optIn}
          onChange={(event) => {
            setOptIn(event.target.value);
          }}
          placeholder="How people opted in"
        />
        <Button type="submit">Add use case</Button>
      </form>
    </div>
  );
}

function Documents() {
  const view = useQuery({ queryKey: ['compliance'], queryFn: () => complianceApi.view() });
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-muted-foreground">
        Documents stay encrypted in the database. Upload from the API with a PDF or image up to 512
        KB.
      </p>
      {(view.data?.documents ?? []).map((item) => (
        <p key={item.id}>
          {item.country} · {item.kind} · {item.filename}
        </p>
      ))}
    </div>
  );
}

function Replies() {
  const view = useQuery({ queryKey: ['compliance'], queryFn: () => complianceApi.view() });
  return (
    <div className="grid gap-3">
      {(view.data?.replies ?? []).map((reply) => (
        <article key={reply.id} className="bg-card rounded-[18px] border p-4 text-sm">
          <p className="font-semibold">
            {reply.category}
            {reply.protected ? ' · protected' : ''}
          </p>
          <p className="mt-1 font-mono text-xs">{reply.keywords.join(', ')}</p>
          <p className="mt-2">{reply.body}</p>
        </article>
      ))}
    </div>
  );
}
