import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Outfit } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
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
    { media: '(prefers-color-scheme: light)', color: '#f1f1f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0f' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={`${outfit.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider nonce={nonce}>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
