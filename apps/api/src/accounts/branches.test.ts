import { Prisma } from '@smsvio/db';
import { describe, expect, it } from 'vitest';

import type { OutboundEmail } from '../mail/mailer.js';
import { createMemoryDb, createMemoryRedis } from '../memory-db.js';
import { RateLimiter } from '../security/rate-limit.js';
import { testEnv } from '../testing.js';
import { AuthService } from './auth.service.js';
import { OptionalSessionGuard, SessionGuard } from './guards.js';
import { SessionService } from './session.service.js';
import { deliver, invalidLink, isUniqueConflict, openSession } from './support.js';
import { TeamService } from './team.service.js';

const client = { ip: '203.0.113.8', userAgent: 'vitest' };
const sent: OutboundEmail[] = [];

function services() {
  const db = createMemoryDb();
  const redis = createMemoryRedis();
  const mailer = {
    send: (message: OutboundEmail) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  const auth = new AuthService(
    db as never,
    redis as never,
    mailer,
    testEnv,
    new RateLimiter(redis as never),
  );
  const sessions = new SessionService(db as never);
  const teams = new TeamService(db as never, mailer, testEnv);
  return { db, auth, sessions, teams };
}

describe('error branches', () => {
  it('covers helper, guard, and rejected account actions', async () => {
    await expect(
      deliver(
        { send: () => Promise.reject(new Error('smtp down')) },
        { to: 'a@b.co', subject: 'S', text: 't', html: 'h' },
      ),
    ).rejects.toMatchObject({ code: 'email_failed' });
    expect(isUniqueConflict(new Error('no'))).toBe(false);
    expect(
      isUniqueConflict(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    ).toBe(true);
    expect(invalidLink().code).toBe('invalid_link');

    const { db, auth, sessions, teams } = services();
    await expect(
      openSession(db as never, '00000000-0000-4000-8000-000000000000', client, null),
    ).rejects.toMatchObject({
      status: 500,
    });

    const signed = await auth.signUp(
      {
        name: 'Ada Owner',
        email: 'ada@example.com',
        password: 'smsvio-phase1-pass',
        organizationName: 'Ada Org',
      },
      client,
    );
    expect(signed.message).toContain('email');
    await expect(auth.verifyEmail('not-a-valid-token-value', client)).rejects.toMatchObject({
      code: 'invalid_link',
    });
    await expect(
      auth.resetPassword('not-a-valid-token-value', 'smsvio-phase1-pass', client),
    ).rejects.toMatchObject({
      code: 'invalid_link',
    });
    await expect(
      auth.completeTotp('not-a-valid-challenge-value', '000000', client),
    ).rejects.toMatchObject({
      code: 'invalid_totp',
    });
    const resent = await auth.resendVerification('missing@example.com', client);
    expect(resent.message).toContain('verification');

    const token = sent
      .find((message) => message.to === 'ada@example.com')
      ?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    const opened = await auth.verifyEmail(token ?? '', client);
    const state = {
      userId: opened.body.user.id,
      sessionId: opened.body.session.id,
      organizationId: opened.body.organization?.id ?? null,
      role: opened.body.organization?.role ?? null,
      body: opened.body,
    };
    await expect(auth.confirmTotp(state, '000000', client)).rejects.toMatchObject({
      code: 'totp_not_started',
    });
    await expect(
      auth.disableTotp(state, 'smsvio-phase1-pass', '000000', client),
    ).rejects.toMatchObject({
      code: 'totp_disabled',
    });
    await expect(auth.setupTotp(state, 'wrong-password')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });

    const invited = await teams
      .invite(state, { email: 'ada@example.com', role: 'VIEWER' }, client)
      .catch((error: unknown) => error);
    expect(invited).toMatchObject({ code: 'already_member' });
    const member = (
      await teams.list(state, {
        q: '',
        role: 'OWNER',
        status: 'ACTIVE',
        sort: 'name',
        direction: 'asc',
        page: 1,
        pageSize: 10,
      })
    ).items[0];
    await expect(teams.changeRole(state, member?.id ?? '', 'ADMIN', client)).rejects.toMatchObject({
      code: 'owner_role',
    });
    await expect(teams.remove(state, member?.id ?? '', client)).rejects.toMatchObject({
      code: 'owner_role',
    });
    await expect(teams.transfer(state, member?.id ?? '', client)).rejects.toMatchObject({
      code: 'own_role',
    });
    await expect(teams.deleteOrganization(state, 'nope', client)).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(teams.preview('not-a-valid-token-value')).rejects.toMatchObject({
      code: 'invalid_link',
    });
    await expect(
      teams.revoke(state, '00000000-0000-4000-8000-000000000099', client),
    ).rejects.toMatchObject({
      code: 'not_found',
    });

    await db.user.update({ where: { id: state.userId }, data: { lastSeenAt: new Date() } });
    await teams.invite(state, { email: 'guest@example.com', role: 'VIEWER' }, client);
    const mixed = await teams.list(state, {
      q: '',
      sort: 'lastSeenAt',
      direction: 'desc',
      page: 1,
      pageSize: 10,
      status: undefined,
    });
    expect(mixed.total).toBe(2);
    const invitedOnly = await teams.list(state, {
      q: 'guest',
      role: 'VIEWER',
      status: 'INVITED',
      sort: 'role',
      direction: 'asc',
      page: 1,
      pageSize: 10,
    });
    expect(invitedOnly.total).toBe(1);

    const reply = { setCookie: () => undefined, clearCookie: () => undefined };
    const guard = new SessionGuard(sessions, testEnv);
    const context = (cookies: Record<string, string>) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ cookies, ip: '203.0.113.8', headers: {} }),
          getResponse: () => reply,
        }),
      }) as never;
    const optional = new OptionalSessionGuard(sessions, testEnv);
    expect(await optional.canActivate(context({}))).toBe(true);
    expect(await optional.canActivate(context({ smsvio_session: 'missing-session' }))).toBe(true);
    const near = await db.session.findMany({ where: { userId: state.userId } });
    const sessionId = near[0]?.id ?? '';
    await db.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(
      await guard.canActivate(
        context({ smsvio_session: opened.sessionToken, smsvio_csrf: opened.csrfToken }),
      ),
    ).toBe(true);
    await db.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(await guard.canActivate(context({ smsvio_session: opened.sessionToken }))).toBe(true);
  });
});
