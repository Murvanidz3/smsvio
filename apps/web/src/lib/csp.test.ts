import { describe, expect, it } from 'vitest';

import { buildCsp, createNonce } from './csp';

describe('buildCsp', () => {
  it('locks scripts and styles to the request nonce in production', () => {
    const csp = buildCsp({ nonce: 'abc123', isDev: false, isHttps: true });

    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-');
  });

  it('relaxes only what the development server needs', () => {
    const csp = buildCsp({ nonce: 'abc123', isDev: true, isHttps: false });

    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('does not upgrade requests on plain HTTP origins', () => {
    expect(buildCsp({ nonce: 'n', isDev: false, isHttps: false })).not.toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('createNonce', () => {
  it('returns a fresh base64 value each call', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(first).not.toBe(second);
  });
});
