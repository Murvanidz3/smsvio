import { createHash } from 'node:crypto';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PRISMA, REDIS } from '@smsvio/server';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp, createFastifyAdapter } from '../app.factory.js';
import { AppModule } from '../app.module.js';
import { loadApiEnv } from '../env.js';
import { MAILER } from '../mail/mailer.js';
import { createMemoryDb, createMemoryRedis } from '../memory-db.js';
import { encryptString } from '../security/encryption.js';

const KEY = 'ab'.repeat(32);
const ORIGIN = 'http://localhost:3000';

let app: NestFastifyApplication;
let server: Server;
let base: string;
let privateKey: CryptoKey;
let kid: string;

interface Issued {
  email: string;
  sub: string;
  verified: boolean;
  nonce: string;
  challenge: string;
}

const issued = new Map<string, Issued>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  kid = 'test-key';
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  server = createServer((req, res) => {
    void handle(req, res, jwk).catch(() => {
      res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${String(address.port)}`;
  const env = loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://smsvio:pw@postgres:5432/smsvio',
    REDIS_URL: 'redis://:pw@redis:6379',
    PUBLIC_ORIGIN: ORIGIN,
    APP_ENCRYPTION_KEY: KEY,
    EMAIL_MODE: 'disabled',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_AUTHORIZATION_ENDPOINT: `${base}/authorize`,
    GOOGLE_TOKEN_ENDPOINT: `${base}/token`,
    GOOGLE_JWKS_URI: `${base}/jwks`,
    GOOGLE_ISSUER: base,
    SEED_ADMIN_EMAIL: 'admin@smsvio.test',
    TRUST_PROXY_HOPS: '0',
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(PRISMA)
    .useValue(createMemoryDb())
    .overrideProvider(REDIS)
    .useValue(createMemoryRedis())
    .overrideProvider(MAILER)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  app = await configureApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(env)),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
});

async function handle(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
  jwk: Record<string, unknown>,
): Promise<void> {
  const url = new URL(req.url ?? '/', base);
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (url.pathname === '/authorize') {
    const code = `code-${url.searchParams.get('state') ?? 'x'}`;
    issued.set(code, {
      email: req.headers['x-test-email']?.toString() ?? 'new.user@example.com',
      sub: req.headers['x-test-sub']?.toString() ?? 'google-sub-new',
      verified: req.headers['x-test-verified'] !== 'false',
      nonce: url.searchParams.get('nonce') ?? '',
      challenge: url.searchParams.get('code_challenge') ?? '',
    });
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? ORIGIN);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
    res.writeHead(302, { location: redirect.toString() }).end();
    return;
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const params = new URLSearchParams(await readBody(req));
    const code = params.get('code') ?? '';
    const pending = issued.get(code);
    const verifier = params.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (pending?.challenge !== challenge) {
      res.writeHead(400).end();
      return;
    }
    const idToken = await new SignJWT({
      email: pending.email,
      email_verified: pending.verified,
      name: 'Ada Lovelace',
      nonce: pending.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(base)
      .setAudience('test-client')
      .setSubject(pending.sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ id_token: idToken }));
    return;
  }
  res.writeHead(404).end();
}

async function googleSignIn(headers: Record<string, string> = {}): Promise<request.Response> {
  const start = await request(app.getHttpServer())
    .get('/api/internal/auth/google/start')
    .redirects(0)
    .expect(302);
  const location = start.headers.location;
  if (location === undefined) {
    throw new Error('Google start did not redirect.');
  }
  const authorized = await fetch(location, { headers, redirect: 'manual' });
  const callback = new URL(authorized.headers.get('location') ?? '');
  return request(app.getHttpServer())
    .get(`/auth/google/callback?${callback.searchParams.toString()}`)
    .redirects(0);
}

describe('Google sign-in when email is disabled', () => {
  it('rejects a callback that has no state', async () => {
    const response = await request(app.getHttpServer()).get('/auth/google/callback').redirects(0);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('error=invalid_state');
  });

  it('refuses to link a Google account that belongs to someone else', async () => {
    const db = app.get(PRISMA);
    await db.user.create({
      data: {
        email: 'owner-a@example.com',
        name: 'Owner A',
        passwordHash: 'hash',
        googleSub: 'google-sub-conflict',
        emailVerifiedAt: new Date(),
        timezone: 'UTC',
      },
    });
    await db.user.create({
      data: {
        email: 'owner-b@example.com',
        name: 'Owner B',
        passwordHash: 'hash',
        emailVerifiedAt: new Date(),
        timezone: 'UTC',
      },
    });
    const callback = await googleSignIn({
      'x-test-email': 'owner-b@example.com',
      'x-test-sub': 'google-sub-conflict',
    });
    expect(callback.headers.location).toContain('error=google_conflict');
  });

  it('rejects email registration and password reset mail', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'smsvio-phase1-pass',
        organizationName: 'Ada Org',
      });
    expect(signup.status).toBe(403);
    expect(signup.body.code).toBe('email_disabled');
    const forgot = await request(app.getHttpServer())
      .post('/api/internal/auth/forgot-password')
      .set('origin', ORIGIN)
      .send({ email: 'ada@example.com' });
    expect(forgot.status).toBe(403);
  });

  it('creates a verified account with no password and names an organization', async () => {
    const callback = await googleSignIn({
      'x-test-email': 'new.user@example.com',
      'x-test-sub': 'google-sub-new',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${ORIGIN}/dashboard`);
    const agent = request.agent(app.getHttpServer());
    agent.set('Cookie', cookieHeader(callback));
    const session = await agent.get('/api/internal/auth/session').expect(200);
    expect(session.body.user).toMatchObject({
      email: 'new.user@example.com',
      hasPassword: false,
      isPlatformAdmin: false,
    });
    expect(session.body.organization).toBeNull();
    const csrf = csrfFrom(callback);
    const created = await agent
      .post('/api/internal/organization')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ name: 'New Org' })
      .expect(200);
    expect(created.body.organization.name).toBe('New Org');
    expect(created.body.organization.role).toBe('OWNER');
    const phone = await agent
      .post('/api/internal/profile/phone')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ phone: '+14155550100' });
    expect(phone.status).toBe(403);
    expect(phone.body.code).toBe('phone_unavailable');
    await agent
      .post('/api/internal/profile/password/set')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ password: 'smsvio-phase1-pass' })
      .expect(200);
    const updated = await agent.get('/api/internal/auth/session').expect(200);
    expect(updated.body.user.hasPassword).toBe(true);
  });

  it('refuses an unverified Google email', async () => {
    const callback = await googleSignIn({
      'x-test-email': 'unverified@example.com',
      'x-test-sub': 'google-sub-unverified',
      'x-test-verified': 'false',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('error=google_email_unverified');
  });

  it('links a verified account and clears an unverified pre-registration', async () => {
    const db = app.get(PRISMA);
    await db.user.create({
      data: {
        email: 'linked@example.com',
        name: 'Linked',
        passwordHash: 'stored-hash',
        emailVerifiedAt: new Date(),
        timezone: 'UTC',
      },
    });
    const linked = await googleSignIn({
      'x-test-email': 'linked@example.com',
      'x-test-sub': 'google-sub-linked',
    });
    expect(linked.headers.location).toBe(`${ORIGIN}/dashboard`);
    const linkedUser = await db.user.findUnique({ where: { email: 'linked@example.com' } });
    expect(linkedUser?.googleSub).toBe('google-sub-linked');
    expect(linkedUser?.passwordHash).toBe('stored-hash');

    const pending = await db.user.create({
      data: {
        email: 'pending@example.com',
        name: 'Pending',
        passwordHash: 'stored-hash',
        timezone: 'UTC',
      },
    });
    await db.session.create({
      data: {
        userId: pending.id,
        tokenHash: 'pending-session',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const taken = await googleSignIn({
      'x-test-email': 'pending@example.com',
      'x-test-sub': 'google-sub-pending',
    });
    expect(taken.headers.location).toBe(`${ORIGIN}/dashboard`);
    const takenUser = await db.user.findUnique({ where: { email: 'pending@example.com' } });
    expect(takenUser?.passwordHash).toBeNull();
    expect(takenUser?.emailVerifiedAt).not.toBeNull();
    const sessions = await db.session.findMany({ where: { userId: pending.id } });
    expect(sessions[0]?.revokedAt).not.toBeNull();
  });

  it('still asks for an authenticator code when two-factor authentication is on', async () => {
    const db = app.get(PRISMA);
    const secret = 'JBSWY3DPEHPK3PXP';
    await db.user.create({
      data: {
        email: 'totp@example.com',
        name: 'Totp',
        passwordHash: null,
        googleSub: 'google-sub-totp',
        emailVerifiedAt: new Date(),
        totpEnabledAt: new Date(),
        totpSecretEnc: encryptString(secret, KEY),
        timezone: 'UTC',
      },
    });
    const callback = await googleSignIn({
      'x-test-email': 'totp@example.com',
      'x-test-sub': 'google-sub-totp',
    });
    expect(callback.headers.location).toBe(`${ORIGIN}/signin?totp=1`);
    expect(cookieHeader(callback)).toContain('smsvio_totp=');
  });

  it('promotes the configured admin email and returns an invitation link', async () => {
    const callback = await googleSignIn({
      'x-test-email': 'admin@smsvio.test',
      'x-test-sub': 'google-sub-admin',
    });
    const agent = request.agent(app.getHttpServer());
    agent.set('Cookie', cookieHeader(callback));
    const csrf = csrfFrom(callback);
    await agent
      .post('/api/internal/organization')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ name: 'Admin Org' })
      .expect(200);
    const session = await agent.get('/api/internal/auth/session').expect(200);
    expect(session.body.user.isPlatformAdmin).toBe(true);
    const invited = await agent
      .post('/api/internal/invitations')
      .set('origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({ email: 'guest@example.com', role: 'VIEWER' })
      .expect(200);
    expect(invited.body.link).toContain('/accept-invite?token=');
    expect(invited.body.message).toContain('Copy this link');
  });
});

function cookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return lines.map((line) => line.split(';')[0]).join('; ');
}

function csrfFrom(response: request.Response): string {
  const header = cookieHeader(response);
  const entry = header.split('; ').find((part) => part.startsWith('smsvio_csrf='));
  return decodeURIComponent(entry?.slice('smsvio_csrf='.length) ?? '');
}
