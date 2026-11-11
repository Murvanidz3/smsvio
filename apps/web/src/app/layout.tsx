import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SMSVIO — Business SMS platform',
    template: '%s · SMSVIO',
  },
  description: 'SMSVIO is a business SMS platform: one dashboard and one API for sending messages.',
  applicationName: 'SMSVIO',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider nonce={nonce}>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
