import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PRISMA } from '@smsvio/server';
import type { PrismaClient } from '@smsvio/db';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.factory.js';
import { loadApiEnv } from '../src/env.js';

const ORIGIN = 'http://127.0.0.1:4000';
const EMAIL = 'google-int@example.com';

let app: NestFastifyApplication;
let server: Server;
let issuer: string;
let privateKey: CryptoKey;
let kid: string;
const issued = new Map<
  string,
  { email: string; sub: string; nonce: string; challenge: string; verified: boolean }
>();

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  kid = 'int';
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  server = createServer((req, res) => {
    void handle(req, res, jwk);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${String(address.port)}`;
  app = await createApp(
    loadApiEnv({
      ...process.env,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: ORIGIN,
      EMAIL_MODE: 'disabled',
      GOOGLE_CLIENT_ID: 'int-client',
      GOOGLE_CLIENT_SECRET: 'int-secret',
      GOOGLE_AUTHORIZATION_ENDPOINT: `${issuer}/authorize`,
      GOOGLE_TOKEN_ENDPOINT: `${issuer}/token`,
      GOOGLE_JWKS_URI: `${issuer}/jwks`,
      GOOGLE_ISSUER: issuer,
      TRUST_PROXY_HOPS: '0',
    }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const prisma = app.get<PrismaClient>(PRISMA);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

afterAll(async () => {
  const prisma = app.get<PrismaClient>(PRISMA);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
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

describe('Google sign-in against Postgres', () => {
  it('refuses email registration and stores a Google account with no password', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/internal/auth/signup')
      .set('origin', ORIGIN)
      .send({
        name: 'Ada',
        email: EMAIL,
        password: 'smsvio-phase1-pass',
        organizationName: 'Ada Org',
      });
    expect(signup.status).toBe(403);

    const start = await request(app.getHttpServer())
      .get('/api/internal/auth/google/start')
      .redirects(0)
      .expect(302);
    const authorized = await fetch(start.headers.location ?? '', { redirect: 'manual' });
    const callbackUrl = new URL(authorized.headers.get('location') ?? ORIGIN);
    const callback = await request(app.getHttpServer())
      .get(`/auth/google/callback?${callbackUrl.searchParams.toString()}`)
      .redirects(0)
      .expect(302);
    expect(callback.headers.location).toBe(`${ORIGIN}/dashboard`);

    const prisma = app.get<PrismaClient>(PRISMA);
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(user?.passwordHash).toBeNull();
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.googleSub).toBe('google-sub-int');
  });
});

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  jwk: Record<string, unknown>,
): Promise<void> {
  const url = new URL(req.url ?? '/', issuer);
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (url.pathname === '/authorize') {
    const code = 'code-int';
    issued.set(code, {
      email: EMAIL,
      sub: 'google-sub-int',
      verified: true,
      nonce: url.searchParams.get('nonce') ?? '',
      challenge: url.searchParams.get('code_challenge') ?? '',
    });
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? ORIGIN);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
    res.writeHead(302, { location: redirect.toString() }).end();
    return;
  }
  if (url.pathname === '/token') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const pending = issued.get(params.get('code') ?? '');
    const challenge = createHash('sha256')
      .update(params.get('code_verifier') ?? '')
      .digest('base64url');
    if (pending?.challenge !== challenge) {
      res.writeHead(400).end();
      return;
    }
    const idToken = await new SignJWT({
      email: pending.email,
      email_verified: true,
      name: 'Google Int',
      nonce: pending.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience('int-client')
      .setSubject(pending.sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ id_token: idToken }));
  }
}
