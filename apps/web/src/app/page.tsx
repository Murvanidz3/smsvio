import type { Metadata } from 'next';

import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: { absolute: 'Coming soon · SMSVIO' },
  description: 'SMSVIO is getting ready.',
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex justify-end px-4 py-5 sm:px-6">
        <ThemeToggle />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-24 text-center">
        <Logo />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Coming soon</h1>
          <p className="text-muted-foreground mt-2">SMSVIO is getting ready.</p>
        </div>
      </div>
    </main>
  );
}
