import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { SESSION_COOKIE } from '@smsvio/shared';

import { SALES_URL } from './company';
import { PhoneDemo } from './phone-demo';
import { loadPublicRates } from './rates';

export const metadata: Metadata = {
  title: { absolute: 'SMSVIO — Send SMS anywhere' },
  description:
    'Send SMS to the countries you enable. One dashboard, one API, and a live delivery status. Prepaid, with no monthly fee.',
};

export default async function LandingPage() {
  const [rates, jar] = await Promise.all([loadPublicRates(), cookies()]);
  const signedIn = jar.get(SESSION_COOKIE)?.value !== undefined;
  const count = new Intl.NumberFormat('en-US').format(rates.count);

  return (
    <section className="mkt-hero">
      <div className="mkt-wrap mkt-hero-grid">
        <div className="mkt-hero-copy mkt-rise">
          <p className="mkt-eyebrow">SMS for every country</p>
          <h1>
            Send SMS anywhere. <em>See</em> every delivery.
          </h1>
          <p className="mkt-lead">
            Reach a phone in any country you enable. One API, a live status for every message, and a
            prepaid balance with no monthly fee.
          </p>
          <div className="mkt-actions">
            {signedIn ? (
              <Link className="mkt-button mkt-button-brand" href="/dashboard">
                Open dashboard
              </Link>
            ) : (
              <Link className="mkt-button mkt-button-brand" href="/signup">
                Get started
              </Link>
            )}
            <a className="mkt-button mkt-button-line" href={SALES_URL} rel="noopener noreferrer">
              Contact sales
            </a>
          </div>
          <p className="mkt-facts">
            {rates.count > 0 ? `${count} countries · ` : null}
            Pay as you go · No monthly fee
          </p>
        </div>
        <div className="mkt-rise mkt-rise-late">
          <PhoneDemo countries={rates.countries} />
        </div>
      </div>
    </section>
  );
}
