import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PRISMA, REDIS } from '@smsvio/server';
import { Secret, TOTP } from 'otpauth';
import request, { type Response, type Agent } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp, createFastifyAdapter } from '../app.factory.js';
import { AppModule } from '../app.module.js';
import { MAILER, type OutboundEmail } from '../mail/mailer.js';
import { createMemoryDb, createMemoryRedis } from '../memory-db.js';
import { testEnv } from '../testing.js';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'smsvio-phase1-pass';

const sent: OutboundEmail[] = [];

let app: NestFastifyApplication;
let owner: Agent;
let csrf = '';

function tokenFrom(message: OutboundEmail | undefined): string {
  const match = message?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`no token in ${message?.text ?? 'missing email'}`);
  }
  return match[1];
}

function codeFrom(message: OutboundEmail | undefined): string {
  const match = message?.text.match(/\b(\d{6})\b/);
  if (match?.[1] === undefined) {
    throw new Error(`no code in ${message?.text ?? 'missing email'}`);
  }
  return match[1];
}

function cookieLines(header: string | string[] | undefined): string[] {
  if (header === undefined) {
    return [];
  }
  return Array.isArray(header) ? header : [header];
}

function captureCsrf(response: Response): void {
  const lines = cookieLines(response.headers['set-cookie']);
  const line = lines.find((entry) => entry.startsWith('smsvio_csrf='));
  if (line !== undefined) {
    csrf = decodeURIComponent(line.split(';')[0]?.slice('smsvio_csrf='.length) ?? '');
  }
}

function authed(agent: Agent, method: 'post' | 'patch' | 'delete', path: string) {
  return agent[method](path).set('origin', ORIGIN).set('x-csrf-token', csrf);
}

function totpCode(email: string, secret: string, timestamp = Date.now()): string {
  return new TOTP({
    issuer: 'SMSVIO',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
    .overrideProvider(PRISMA)
    .useValue(createMemoryDb())
    .overrideProvider(REDIS)
    .useValue(createMemoryRedis())
    .overrideProvider(MAILER)
    .useValue({
      send: (message: OutboundEmail) => {
        sent.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  app = await configureApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(testEnv)),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = request.agent(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
});

describe('accounts', () => {
  it('signs up, verifies, and rejects a repeated signup with the same message', async () => {
    const body = {
      name: 'Ada Owner',
      email: 'ada@example.com',
      password: PASSWORD,
      organizationName: 'Ada Org',
    };
    const created = await owner
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send(body)
      .expect(200);
    expect(created.body.message).toContain('email');
    const again = await owner
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send(body)
      .expect(200);
    expect(again.body).toEqual(created.body);
    expect(sent.some((message) => message.subject.includes('already'))).toBe(false);

    const verified = await owner
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom(sent.filter((message) => message.to === 'ada@example.com').at(-1)) })
      .expect(200);
    captureCsrf(verified);
    expect(verified.body.user.email).toBe('ada@example.com');
    expect(verified.body.organization.name).toBe('Ada Org');
    expect(verified.body.organization.status).toBe('PENDING_VERIFICATION');

    const duplicate = await authed(owner, 'post', '/api/internal/auth/signup')
      .send(body)
      .expect(200);
    expect(duplicate.body).toEqual(created.body);
    expect(sent.map((message) => message.subject)).toContain('Sign in to SMSVIO');
  }, 60_000);

  it('rejects a bad origin and a missing CSRF token', async () => {
    await owner
      .post('/api/internal/auth/signout')
      .set('origin', 'https://evil.example')
      .expect(403);
    await owner.post('/api/internal/auth/signout').set('origin', ORIGIN).expect(403);
  });

  it('updates profile, details, phone, and business settings', async () => {
    const profile = await authed(owner, 'patch', '/api/internal/profile')
      .send({ name: 'Ada Lovelace' })
      .expect(200);
    expect(profile.body.user.name).toBe('Ada Lovelace');

    const details = await authed(owner, 'patch', '/api/internal/profile/details')
      .send({ timezone: 'America/New_York', contactPhone: '+14155552671' })
      .expect(200);
    expect(details.body.user.timezone).toBe('America/New_York');

    const before = sent.length;
    await authed(owner, 'post', '/api/internal/profile/phone')
      .send({ phone: '+14155550100' })
      .expect(200);
    const phoneMail = sent.slice(before).find((message) => message.to === 'ada@example.com');
    await authed(owner, 'post', '/api/internal/profile/phone/confirm')
      .send({ code: '000000' })
      .expect(400);
    const confirmed = await authed(owner, 'post', '/api/internal/profile/phone/confirm')
      .send({ code: codeFrom(phoneMail) })
      .expect(200);
    expect(confirmed.body.user.accountPhoneE164).toBe('+14155550100');

    const business = await authed(owner, 'patch', '/api/internal/organization')
      .send({ legalName: 'Ada Org LLC', taxIdType: 'EIN', taxId: '12-3456789' })
      .expect(200);
    expect(business.body.organization.legalName).toBe('Ada Org LLC');

    const session = await owner.get('/api/internal/auth/session').expect(200);
    expect(session.body.user.name).toBe('Ada Lovelace');
    const members = await owner.get('/api/internal/members').expect(200);
    expect(members.body.total).toBe(1);
    const audit = await owner.get('/api/internal/audit').expect(200);
    expect(audit.body.total).toBeGreaterThan(0);
  }, 60_000);

  it('invites a viewer, accepts into a new account, and enforces roles', async () => {
    const before = sent.length;
    const invited = await authed(owner, 'post', '/api/internal/invitations')
      .send({ email: 'viewer@example.com', role: 'VIEWER' })
      .expect(200);
    const inviteMail = sent.slice(before).find((message) => message.to === 'viewer@example.com');
    const token = tokenFrom(inviteMail);
    const preview = await authed(owner, 'post', '/api/internal/auth/invitations/preview')
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      email: 'viewer@example.com',
      hasAccount: false,
      role: 'VIEWER',
    });

    const resent = await authed(
      owner,
      'post',
      `/api/internal/invitations/${invited.body.id}/resend`,
    ).expect(200);
    expect(resent.body.message).toContain('Invitation');
    const latest = tokenFrom(sent.filter((message) => message.to === 'viewer@example.com').at(-1));

    const guest = request.agent(app.getHttpServer());
    const accepted = await guest
      .post('/api/internal/auth/invitations/accept')
      .set('origin', ORIGIN)
      .set('cookie', 'smsvio_session=not-a-session; smsvio_csrf=csrf-token-value')
      .set('x-csrf-token', 'csrf-token-value')
      .send({ token: latest, name: 'Vera Viewer', password: PASSWORD })
      .expect(200);
    expect(accepted.body.organization.role).toBe('VIEWER');
    const guestCsrf = decodeURIComponent(
      cookieLines(accepted.headers['set-cookie'])
        .find((entry) => entry.startsWith('smsvio_csrf='))
        ?.split(';')[0]
        ?.slice('smsvio_csrf='.length) ?? '',
    );
    await guest
      .post('/api/internal/invitations')
      .set('origin', ORIGIN)
      .set('x-csrf-token', guestCsrf)
      .send({ email: 'extra@example.com', role: 'ADMIN' })
      .expect(403);

    const directory = await owner
      .get('/api/internal/members?q=vera&sort=email&direction=desc')
      .expect(200);
    const viewer = directory.body.items.find(
      (item: { email: string }) => item.email === 'viewer@example.com',
    );
    const ownerRow = (await owner.get('/api/internal/members')).body.items.find(
      (item: { role: string }) => item.role === 'OWNER',
    );
    await authed(owner, 'patch', `/api/internal/members/${ownerRow.id}`)
      .send({ role: 'ADMIN' })
      .expect(409);
    const promoted = await authed(owner, 'patch', `/api/internal/members/${viewer.id}`)
      .send({ role: 'ADMIN' })
      .expect(200);
    expect(promoted.body.message).toContain('Role');

    const transferred = await authed(
      owner,
      'post',
      `/api/internal/members/${viewer.id}/transfer`,
    ).expect(200);
    expect(transferred.body.organization.role).toBe('ADMIN');
    await authed(owner, 'post', `/api/internal/members/${ownerRow.id}/transfer`).expect(403);
  }, 60_000);

  it('lists and revokes sessions, resets the password, and turns on two-factor authentication', async () => {
    const second = request.agent(app.getHttpServer());
    const signedIn = await second
      .post('/api/internal/auth/signin')
      .set('origin', ORIGIN)
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200);
    expect(signedIn.body.user.email).toBe('ada@example.com');
    const sessions = await owner.get('/api/internal/sessions').expect(200);
    expect(sessions.body.items.length).toBeGreaterThan(1);
    const other = sessions.body.items.find((item: { current: boolean }) => !item.current);
    await authed(owner, 'delete', `/api/internal/sessions/${other.id}`).expect(200);
    await second.get('/api/internal/auth/session').expect(401);

    const before = sent.length;
    const forgot = await authed(owner, 'post', '/api/internal/auth/forgot-password')
      .send({ email: 'ada@example.com' })
      .expect(200);
    const unknown = await authed(owner, 'post', '/api/internal/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect(unknown.body).toEqual(forgot.body);
    const resetToken = tokenFrom(
      sent.slice(before).find((message) => message.to === 'ada@example.com'),
    );
    await authed(owner, 'post', '/api/internal/auth/reset-password')
      .send({ token: resetToken, password: 'smsvio-phase1-next' })
      .expect(200);
    await owner.get('/api/internal/auth/session').expect(401);

    const fresh = await owner
      .post('/api/internal/auth/signin')
      .set('origin', ORIGIN)
      .send({ email: 'ada@example.com', password: 'smsvio-phase1-next' })
      .expect(200);
    captureCsrf(fresh);
    const setup = await authed(owner, 'post', '/api/internal/profile/totp/setup')
      .send({ currentPassword: 'smsvio-phase1-next' })
      .expect(200);
    const currentCode = totpCode('ada@example.com', setup.body.secret);
    const confirmed = await authed(owner, 'post', '/api/internal/profile/totp/confirm')
      .send({ code: currentCode })
      .expect(200);
    expect(confirmed.body.user.totpEnabled).toBe(true);

    await authed(owner, 'post', '/api/internal/auth/signout').expect(200);
    const challenged = await owner
      .post('/api/internal/auth/signin')
      .set('origin', ORIGIN)
      .send({ email: 'ada@example.com', password: 'smsvio-phase1-next' })
      .expect(200);
    expect(challenged.body.status).toBe('totp_required');
    const completed = await owner
      .post('/api/internal/auth/totp')
      .set('origin', ORIGIN)
      .send({
        challenge: challenged.body.challenge,
        code: totpCode('ada@example.com', setup.body.secret, Date.now() + 30_000),
      })
      .expect(200);
    captureCsrf(completed);
    expect(completed.body.user.email).toBe('ada@example.com');

    await new Promise((resolve) => {
      setTimeout(resolve, 31_000);
    });
    const disabled = await authed(owner, 'post', '/api/internal/profile/totp/disable')
      .send({
        currentPassword: 'smsvio-phase1-next',
        code: totpCode('ada@example.com', setup.body.secret, Date.now() + 30_000),
      })
      .expect(200);
    expect(disabled.body.user.totpEnabled).toBe(false);
  }, 120_000);

  it('keeps a second organization from seeing the first', async () => {
    const other = request.agent(app.getHttpServer());
    await other
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Bea Other',
        email: 'bea@example.com',
        password: PASSWORD,
        organizationName: 'Bea Org',
      })
      .expect(200);
    const verified = await other
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({ token: tokenFrom(sent.filter((message) => message.to === 'bea@example.com').at(-1)) })
      .expect(200);
    const otherCsrf = decodeURIComponent(
      cookieLines(verified.headers['set-cookie'])
        .find((entry) => entry.startsWith('smsvio_csrf='))
        ?.split(';')[0]
        ?.slice('smsvio_csrf='.length) ?? '',
    );
    const foreignOrg = (await owner.get('/api/internal/auth/session')).body.organization
      .id as string;
    await other
      .post('/api/internal/organization/switch')
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .send({ organizationId: foreignOrg })
      .expect(404);

    const foreignMember = (await owner.get('/api/internal/members')).body.items[0].id as string;
    await other
      .patch(`/api/internal/members/${foreignMember}`)
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .send({ role: 'ADMIN' })
      .expect(404);

    const wrong = await other
      .post('/api/internal/auth/signin')
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .send({ email: 'missing@example.com', password: PASSWORD })
      .expect(401);
    const alsoWrong = await other
      .post('/api/internal/auth/signin')
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .send({ email: 'ada@example.com', password: 'not-the-password' })
      .expect(401);
    expect(alsoWrong.body).toEqual(wrong.body);

    await other
      .post('/api/internal/organization/delete')
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .send({ confirmName: 'nope' })
      .expect(400);
    const deleted = await other
      .post('/api/internal/organization/delete')
      .set('origin', ORIGIN)
      .set('x-csrf-token', otherCsrf)
      .send({ confirmName: 'Bea Org' })
      .expect(200);
    expect(deleted.body.organization).toBeNull();
  }, 60_000);

  it('changes the password and rejects an unverified sign-in the same way as a bad password', async () => {
    await authed(owner, 'post', '/api/internal/auth/signup')
      .send({
        name: 'Cara Pending',
        email: 'cara@example.com',
        password: PASSWORD,
        organizationName: 'Cara Org',
      })
      .expect(200);
    const pending = await authed(owner, 'post', '/api/internal/auth/signin')
      .send({ email: 'cara@example.com', password: PASSWORD })
      .expect(401);
    const missing = await authed(owner, 'post', '/api/internal/auth/signin')
      .send({ email: 'ghost@example.com', password: PASSWORD })
      .expect(401);
    expect(pending.body).toEqual(missing.body);

    const changed = await authed(owner, 'post', '/api/internal/profile/password').send({
      currentPassword: 'smsvio-phase1-next',
      password: 'smsvio-phase1-final',
    });
    expect(changed.status).toBe(200);
    const resigned = await authed(owner, 'post', '/api/internal/auth/signin')
      .send({ email: 'ada@example.com', password: 'smsvio-phase1-final' })
      .expect(200);
    captureCsrf(resigned);
  }, 60_000);

  it('removes a member, revokes an invitation, switches organization, and ends the current session', async () => {
    const pending = await authed(owner, 'post', '/api/internal/invitations')
      .send({ email: 'pending@example.com', role: 'BILLING' })
      .expect(200);
    await authed(owner, 'delete', `/api/internal/invitations/${pending.body.id}`).expect(200);

    const before = sent.length;
    await authed(owner, 'post', '/api/internal/invitations')
      .send({ email: 'dev@example.com', role: 'DEVELOPER' })
      .expect(200);
    const dev = request.agent(app.getHttpServer());
    const accepted = await dev
      .post('/api/internal/auth/invitations/accept')
      .set('origin', ORIGIN)
      .send({
        token: tokenFrom(sent.slice(before).find((message) => message.to === 'dev@example.com')),
        name: 'Dev Member',
        password: PASSWORD,
      })
      .expect(200);
    expect(accepted.body.organization.role).toBe('DEVELOPER');
    const directory = await owner
      .get('/api/internal/members?status=ACTIVE&role=DEVELOPER')
      .expect(200);
    const membershipId = directory.body.items[0].id as string;
    await authed(owner, 'delete', `/api/internal/members/${membershipId}`).expect(200);

    const invitedBefore = sent.length;
    await authed(owner, 'post', '/api/internal/invitations')
      .send({ email: 'switch@example.com', role: 'ADMIN' })
      .expect(200);
    const joiner = request.agent(app.getHttpServer());
    await joiner
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Sam Switch',
        email: 'switch@example.com',
        password: PASSWORD,
        organizationName: 'Sam Org',
      })
      .expect(200);
    const joined = await joiner
      .post('/api/internal/auth/verify-email')
      .set('origin', ORIGIN)
      .send({
        token: tokenFrom(
          sent
            .filter(
              (message) =>
                message.to === 'switch@example.com' && message.subject.includes('Confirm'),
            )
            .at(-1),
        ),
      })
      .expect(200);
    const joinerCsrf = decodeURIComponent(
      cookieLines(joined.headers['set-cookie'])
        .find((entry) => entry.startsWith('smsvio_csrf='))
        ?.split(';')[0]
        ?.slice('smsvio_csrf='.length) ?? '',
    );
    const homeOrg = joined.body.organization.id as string;
    const switched = await joiner
      .post('/api/internal/auth/invitations/accept')
      .set('origin', ORIGIN)
      .set('x-csrf-token', joinerCsrf)
      .send({
        token: tokenFrom(
          sent.slice(invitedBefore).find((message) => message.to === 'switch@example.com'),
        ),
      })
      .expect(200);
    expect(switched.body.organization.name).toBe('Ada Org');
    const back = await joiner
      .post('/api/internal/organization/switch')
      .set('origin', ORIGIN)
      .set('x-csrf-token', joinerCsrf)
      .send({ organizationId: homeOrg })
      .expect(200);
    expect(back.body.organization.name).toBe('Sam Org');

    const anonymous = await request(app.getHttpServer())
      .post('/api/internal/auth/invitations/accept')
      .set('origin', ORIGIN)
      .send({ token: 'not-a-real-token-value-here' })
      .expect(400);
    expect(anonymous.body.code).toBe('invalid_link');

    const sessions = await owner.get('/api/internal/sessions').expect(200);
    const current = sessions.body.items.find((item: { current: boolean }) => item.current);
    await authed(owner, 'delete', `/api/internal/sessions/${current.id}`).expect(200);
    await owner.get('/api/internal/auth/session').expect(401);
  }, 60_000);
});
