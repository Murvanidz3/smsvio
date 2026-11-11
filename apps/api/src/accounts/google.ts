import { createHash, randomBytes } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { ApiEnv } from '../env.js';

const GOOGLE_AUTHORIZATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER = 'https://accounts.google.com';

export interface GoogleEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly issuer: string;
}

export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string | undefined;
}

export function googleConfigured(env: ApiEnv): boolean {
  return env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
}

export function googleEndpoints(env: ApiEnv): GoogleEndpoints {
  if (env.NODE_ENV === 'production') {
    return {
      authorizationEndpoint: GOOGLE_AUTHORIZATION,
      tokenEndpoint: GOOGLE_TOKEN,
      jwksUri: GOOGLE_JWKS,
      issuer: GOOGLE_ISSUER,
    };
  }
  return {
    authorizationEndpoint: env.GOOGLE_AUTHORIZATION_ENDPOINT ?? GOOGLE_AUTHORIZATION,
    tokenEndpoint: env.GOOGLE_TOKEN_ENDPOINT ?? GOOGLE_TOKEN,
    jwksUri: env.GOOGLE_JWKS_URI ?? GOOGLE_JWKS,
    issuer: env.GOOGLE_ISSUER ?? GOOGLE_ISSUER,
  };
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizationUrl(input: {
  endpoints: GoogleEndpoints;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const url = new URL(input.endpoints.authorizationEndpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function googleRedirectUri(origin: string): string {
  return new URL('/auth/google/callback', origin).toString();
}

const NAME_PATTERN = /^[\p{L}\p{M}\p{N} .'-]+$/u;

export function googleDisplayName(name: string | undefined, email: string): string {
  if (name !== undefined) {
    const trimmed = name.trim().slice(0, 80);
    if (trimmed.length > 0 && NAME_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  const local = email
    .split('@')[0]
    ?.replace(/[^A-Za-z0-9 .'-]/g, '')
    .slice(0, 80);
  return local !== undefined && local.length > 0 ? local : 'Member';
}

export async function exchangeGoogleCode(input: {
  endpoints: GoogleEndpoints;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  const response = await fetch(input.endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error('token_exchange_failed');
  }
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('id_token' in payload)) {
    throw new Error('token_exchange_failed');
  }
  const idToken = payload.id_token;
  if (typeof idToken !== 'string' || idToken.length === 0) {
    throw new Error('token_exchange_failed');
  }
  return idToken;
}

export async function verifyGoogleIdToken(input: {
  idToken: string;
  jwks: JWTVerifyGetKey;
  issuer: string;
  audience: string;
  nonce: string;
}): Promise<GoogleIdentity> {
  const issuers =
    input.issuer === GOOGLE_ISSUER ? [GOOGLE_ISSUER, 'accounts.google.com'] : [input.issuer];
  const { payload } = await jwtVerify(input.idToken, input.jwks, {
    issuer: issuers,
    audience: input.audience,
    clockTolerance: 5,
  });
  if (payload.nonce !== input.nonce) {
    throw new Error('nonce_mismatch');
  }
  const email = payload.email;
  const verified = payload.email_verified;
  if (typeof email !== 'string' || email.length === 0 || verified !== true) {
    throw new Error('email_unverified');
  }
  const sub = payload.sub;
  if (sub === undefined || sub.length === 0) {
    throw new Error('missing_subject');
  }
  const name = payload.name;
  return {
    sub,
    email: email.toLowerCase(),
    name: typeof name === 'string' ? name : undefined,
  };
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function googleJwks(jwksUri: string): JWTVerifyGetKey {
  const cached = jwksCache.get(jwksUri);
  if (cached !== undefined) {
    return cached;
  }
  const created = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, created);
  return created;
}
