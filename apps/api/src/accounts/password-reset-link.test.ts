import { describe, expect, it } from 'vitest';

import { createMemoryDb } from '../memory-db.js';
import { buildPasswordResetLink } from './password-reset-link.js';

describe('buildPasswordResetLink', () => {
  it('returns a one-time link and does not include the token in the error', async () => {
    const db = createMemoryDb();
    await db.user.create({
      data: {
        email: 'ada@example.com',
        name: 'Ada',
        passwordHash: 'hash',
        timezone: 'UTC',
      },
    });
    const link = await buildPasswordResetLink(db as never, 'https://smsvio.com', 'Ada@Example.com');
    const url = new URL(link);
    expect(url.origin).toBe('https://smsvio.com');
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('token')?.length).toBeGreaterThan(20);
    await expect(
      buildPasswordResetLink(db as never, 'https://smsvio.com', 'missing@example.com'),
    ).rejects.toThrow('No account uses that email.');
  });
});
