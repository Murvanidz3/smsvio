import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
      <p className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">
        Launching soon
      </p>
      <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
        Business SMS, from one dashboard and one API.
      </h1>
      <p className="text-muted-foreground mt-5 max-w-xl text-lg text-pretty">
        SMSVIO helps teams send transactional and marketing messages to phones around the world. We
        are getting the platform ready for launch.
      </p>
      <Button asChild size="lg" className="mt-9 h-11 px-5 text-base">
        <Link href="/signin">
          Sign in
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}
