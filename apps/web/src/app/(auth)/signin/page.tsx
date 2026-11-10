import { ArrowLeft, LockKeyhole } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <section
      aria-labelledby="signin-title"
      className="bg-card text-card-foreground w-full max-w-sm rounded-2xl border p-8 shadow-sm"
    >
      <span className="bg-accent text-accent-foreground inline-flex size-10 items-center justify-center rounded-lg">
        <LockKeyhole className="size-5" aria-hidden />
      </span>
      <h1 id="signin-title" className="mt-5 text-2xl font-bold tracking-tight">
        Sign in to SMSVIO
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Account sign-in is not open yet. It will be available here when SMSVIO launches.
      </p>
      <Button asChild variant="outline" className="mt-6 w-full">
        <Link href="/">
          <ArrowLeft data-icon="inline-start" aria-hidden />
          Back to home
        </Link>
      </Button>
    </section>
  );
}
