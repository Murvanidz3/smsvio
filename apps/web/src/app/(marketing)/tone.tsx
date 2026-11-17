'use client';

import { useEffect } from 'react';

/** Keeps the page ivory when the dashboard theme has marked the document dark. */
export function MarketingTone() {
  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#faf9f6';
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, []);
  return null;
}
