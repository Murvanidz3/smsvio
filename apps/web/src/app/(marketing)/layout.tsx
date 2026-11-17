import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@smsvio/shared';
import type { ReactNode } from 'react';

import { MarketingFooter } from './footer';
import { MarketingHeader } from './header';
import { MarketingTone } from './tone';

import './marketing.css';

const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-mkt-display',
});

const sans = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-mkt-sans',
});

const mono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-mkt-mono',
});

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const signedIn = jar.get(SESSION_COOKIE)?.value !== undefined;

  return (
    <div className={`mkt ${display.variable} ${sans.variable} ${mono.variable}`} data-marketing="">
      <div className="mkt-atmosphere" aria-hidden>
        <span className="mkt-orb mkt-orb-a" />
        <span className="mkt-orb mkt-orb-b" />
        <span className="mkt-orb mkt-orb-c" />
      </div>
      <MarketingTone />
      <a className="mkt-skip" href="#content">
        Skip to content
      </a>
      <MarketingHeader signedIn={signedIn} />
      <main id="content">{children}</main>
      <MarketingFooter />
    </div>
  );
}
