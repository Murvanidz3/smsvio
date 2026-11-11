'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

export default function OverviewPage() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const user = session.data?.user;
  const organization = session.data?.organization;

  function createOrganization(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void accountApi
      .createOrganization(name)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ['session'] });
      })
      .catch((error: unknown) => {
        toast(error instanceof ApiError ? error.message : 'Could not create the organization.');
      });
  }

  return (
    <section className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome{user === undefined ? '' : `, ${user.name}`}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {organization === null || organization === undefined
            ? 'Name your organization to start working with a team.'
            : `${organization.name} is ${organization.status === 'PENDING_VERIFICATION' ? 'waiting for business verification' : organization.status.toLowerCase()}.`}
        </p>
      </div>
      {organization === null && user !== undefined ? (
        <form className="grid max-w-sm gap-3" onSubmit={createOrganization}>
          <label className="grid gap-1.5 text-sm font-medium">
            Organization
            <input
              className="border-input h-10 rounded-lg border px-3 font-normal"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <Button type="submit">Create organization</Button>
        </form>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/dashboard/templates" className="bg-card rounded-2xl border p-5">
          <h2 className="font-semibold">Templates</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Draft a message and submit it for review.
          </p>
        </Link>
        <Link href="/dashboard/contacts" className="bg-card rounded-2xl border p-5">
          <h2 className="font-semibold">Contacts</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Keep the numbers your organization writes to.
          </p>
        </Link>
        <Link href="/dashboard/users" className="bg-card rounded-2xl border p-5">
          <h2 className="font-semibold">Users</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Invite teammates and review who has access.
          </p>
        </Link>
        <Link href="/dashboard/settings" className="bg-card rounded-2xl border p-5">
          <h2 className="font-semibold">Settings</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Profile, security, phone, and business details.
          </p>
        </Link>
      </div>
    </section>
  );
}
