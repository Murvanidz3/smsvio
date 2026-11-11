import { AuthTokenPurpose } from '@smsvio/db';
import { PASSWORD_RESET_TTL_MS } from '@smsvio/shared';

import { issueToken, type Db } from './support.js';

/** Creates a one-time reset URL. The caller prints it; this function does not log it. */
export async function buildPasswordResetLink(
  db: Db,
  origin: string,
  email: string,
): Promise<string> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (user === null) {
    throw new Error('No account uses that email.');
  }
  const token = await issueToken(db, {
    userId: user.id,
    purpose: AuthTokenPurpose.PASSWORD_RESET,
    ttlMs: PASSWORD_RESET_TTL_MS,
  });
  const url = new URL('/reset-password', origin);
  url.searchParams.set('token', token);
  return url.toString();
}
