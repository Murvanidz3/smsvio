import Link from 'next/link';
import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="SMSVIO home" className="rounded-md">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
