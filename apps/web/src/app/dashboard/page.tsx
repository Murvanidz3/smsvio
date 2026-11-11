'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { accountApi } from '@/lib/api';

export default function OverviewPage() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const user = session.data?.user;
  const organization = session.data?.organization;

  return (
    <section className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome{user === undefined ? '' : `, ${user.name}`}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {organization === null || organization === undefined
            ? 'You are signed in. Join an organization to start working with a team.'
            : `${organization.name} is ${organization.status === 'PENDING_VERIFICATION' ? 'waiting for business verification' : organization.status.toLowerCase()}.`}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
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
