'use client';

import { useEffect, useRef, useState } from 'react';

import { SALES_URL } from './company';
import { describeDraft, EXAMPLE_MESSAGE } from './draft';
import type { MarketingCountry } from './rates';

type Delivery = 'idle' | 'queued' | 'sent' | 'delivered';

export function PhoneDemo({ countries }: { countries: readonly MarketingCountry[] }) {
  const initial = countries.find((country) => country.iso === 'US')?.iso ?? countries[0]?.iso ?? '';
  const [iso, setIso] = useState(initial);
  const [text, setText] = useState(EXAMPLE_MESSAGE);
  const [preview, setPreview] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery>('idle');
  const timers = useRef<number[]>([]);
  const summary = describeDraft(text);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  function play() {
    for (const timer of timers.current) {
      window.clearTimeout(timer);
    }
    timers.current = [];
    setPreview(text);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setDelivery('delivered');
      return;
    }
    setDelivery('queued');
    timers.current = [
      window.setTimeout(() => {
        setDelivery('sent');
      }, 700),
      window.setTimeout(() => {
        setDelivery('delivered');
      }, 1400),
    ];
  }

  const label = deliveryLabel(delivery);

  return (
    <div className="mkt-demo">
      <div className="mkt-phone" aria-hidden={preview === null}>
        <div className="mkt-screen">
          <p className="mkt-screen-top">
            <span>Messages</span>
            <span className="mkt-dot" aria-hidden />
          </p>
          {preview === null ? (
            <p className="mkt-phone-empty">Your message appears here.</p>
          ) : (
            <div className="mkt-thread">
              <p className="mkt-bubble">{preview}</p>
              {label === null ? null : (
                <p
                  className={delivery === 'delivered' ? 'mkt-status is-delivered' : 'mkt-status'}
                  data-testid="delivery-status"
                >
                  {label}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <form
        className="mkt-composer"
        onSubmit={(event) => {
          event.preventDefault();
          play();
        }}
      >
        <label className="mkt-field">
          <span>Destination</span>
          <select
            value={iso}
            disabled={countries.length === 0}
            onChange={(event) => {
              setIso(event.target.value);
            }}
          >
            {countries.length === 0 ? <option value="">Country list unavailable</option> : null}
            {countries.map((country) => (
              <option key={country.iso} value={country.iso}>
                {country.name} +{country.dialCode.replace(/^\+/, '')}
              </option>
            ))}
          </select>
        </label>
        <label className="mkt-field">
          <span>Message</span>
          <textarea
            value={text}
            rows={3}
            maxLength={1600}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </label>
        <div
          className="mkt-counter"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="segment-counter"
        >
          <span>{summary.encoding}</span>
          <span>{summary.left} characters left</span>
          <span>
            {summary.segments} {summary.segments === 1 ? 'segment' : 'segments'}
          </span>
          <span>{summary.limit} per segment</span>
        </div>
        <p className="mkt-rate">
          Rates are quoted for each country.{' '}
          <a className="mkt-text-link" href={SALES_URL} rel="noopener noreferrer">
            Contact sales
          </a>
        </p>
        <button type="submit" className="mkt-button mkt-button-brand">
          Preview delivery
        </button>
        <p className="mkt-hint">Preview only. Nothing is sent.</p>
      </form>
    </div>
  );
}

function deliveryLabel(delivery: Delivery): string | null {
  if (delivery === 'queued') {
    return 'Queued';
  }
  if (delivery === 'sent') {
    return 'Sent';
  }
  if (delivery === 'delivered') {
    return 'Delivered';
  }
  return null;
}
