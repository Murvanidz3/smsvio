import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { testEnv } from '../testing.js';
import {
  exchangeGoogleCode,
  googleDisplayName,
  googleEndpoints,
  googleJwks,
  verifyGoogleIdToken,
} from './google.js';

describe('Google helpers', () => {
  it('falls back when Google does not provide a usable name', () => {
    expect(googleDisplayName('Ada Lovelace', 'ada@example.com')).toBe('Ada Lovelace');
    expect(googleDisplayName('***', 'ada.lovelace@example.com')).toBe('ada.lovelace');
    expect(googleDisplayName(undefined, '@@@')).toBe('Member');
  });

  it('uses the real Google endpoints in production and the defaults otherwise', () => {
    expect(googleEndpoints({ ...testEnv, NODE_ENV: 'production' }).issuer).toBe(
      'https://accounts.google.com',
    );
    expect(googleEndpoints(testEnv).authorizationEndpoint).toContain('accounts.google.com');
  });

  it('rejects a token response that is not an ID token', async () => {
    const server = createServer((req, res) => {
      res.writeHead(req.url === '/bad' ? 200 : 401, { 'content-type': 'application/json' });
      res.end(req.url === '/bad' ? '{}' : '');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const endpoints = {
      authorizationEndpoint: 'http://127.0.0.1/authorize',
      tokenEndpoint: `http://127.0.0.1:${String(address.port)}/token`,
      jwksUri: 'http://127.0.0.1/jwks',
      issuer: 'http://127.0.0.1',
    };
    const input = {
      endpoints,
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/google/callback',
      code: 'code',
      verifier: 'verifier',
    };
    await expect(exchangeGoogleCode(input)).rejects.toThrow('token_exchange_failed');
    await expect(
      exchangeGoogleCode({
        ...input,
        endpoints: {
          ...endpoints,
          tokenEndpoint: endpoints.tokenEndpoint.replace('/token', '/bad'),
        },
      }),
    ).rejects.toThrow('token_exchange_failed');
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

  it('rejects a mismatched nonce and accepts the Google issuer alias', async () => {
    const keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    jwk.kid = 'alias';
    const server = createServer((_req, res) => {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const token = await new SignJWT({
      email: 'ada@example.com',
      email_verified: true,
      nonce: 'one',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'alias' })
      .setIssuer('https://accounts.google.com')
      .setAudience('client')
      .setSubject('sub')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);
    const jwks = googleJwks(`http://127.0.0.1:${String(address.port)}/jwks`);
    await expect(
      verifyGoogleIdToken({
        idToken: token,
        jwks,
        issuer: 'https://accounts.google.com',
        audience: 'client',
        nonce: 'other',
      }),
    ).rejects.toThrow('nonce_mismatch');
    await expect(
      verifyGoogleIdToken({
        idToken: token,
        jwks,
        issuer: 'https://accounts.google.com',
        audience: 'client',
        nonce: 'one',
      }),
    ).resolves.toMatchObject({ email: 'ada@example.com', sub: 'sub' });
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
});
