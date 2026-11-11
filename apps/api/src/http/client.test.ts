import { describe, expect, it } from 'vitest';

import { assertCsrf, assertOrigin, clientInfo, hasSessionCookie, requestPath } from './client.js';

function request(partial: Record<string, unknown>) {
  return {
    ip: '203.0.113.10',
    url: '/api/internal/auth/session',
    headers: {},
    cookies: {},
    ...partial,
  } as never;
}

describe('request helpers', () => {
  it('reads the client, the path, and a matching origin', () => {
    expect(clientInfo(request({ ip: '', headers: { 'user-agent': 1 } }))).toEqual({
      ip: null,
      userAgent: null,
    });
    expect(
      clientInfo(request({ ip: 'x'.repeat(80), headers: { 'user-agent': 'browser' } })).ip,
    ).toHaveLength(64);
    expect(requestPath(request({ url: '/api/internal/members?q=ada' }))).toBe(
      '/api/internal/members',
    );
    expect(() => {
      assertOrigin(
        request({ headers: { origin: 'https://evil.example' } }),
        'http://localhost:3000',
      );
    }).toThrow(/SMSVIO site/);
    assertOrigin(
      request({ headers: { origin: 'http://localhost:3000' } }),
      'http://localhost:3000',
    );
  });

  it('compares the CSRF cookie with the header', () => {
    expect(hasSessionCookie(request({ cookies: {} }))).toBe(false);
    expect(() => {
      assertCsrf(
        request({ cookies: { smsvio_csrf: 'abc' }, headers: { 'x-csrf-token': ['nope'] } }),
      );
    }).toThrow(/Refresh the page/);
    assertCsrf(request({ cookies: { smsvio_csrf: 'abc' }, headers: { 'x-csrf-token': 'abc' } }));
  });
});
