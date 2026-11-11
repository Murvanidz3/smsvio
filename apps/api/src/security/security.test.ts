import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testEnv } from '../testing.js';
import { VerifyEmail } from '../mail/templates.js';
import { createMailer, emailSubject, renderMessage } from '../mail/mailer.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { applySessionCookies, clearAuthCookies, cookieSecure } from './cookies.js';
import { decryptString, encryptString } from './encryption.js';
import { decideRateLimit, RateLimiter } from './rate-limit.js';
import { hashToken, randomCode, randomToken, tokensEqual } from './tokens.js';

const KEY = 'ab'.repeat(32);

describe('tokens and encryption', () => {
  it('hashes tokens and rejects a different length', () => {
    const token = randomToken();
    expect(tokensEqual(hashToken(token), hashToken(token))).toBe(true);
    expect(tokensEqual('short', 'much-longer-value')).toBe(false);
    expect(randomCode()).toMatch(/^\d{6}$/);
  });

  it('round-trips a secret and rejects tampered ciphertext', () => {
    const cipher = encryptString('secret-value', KEY);
    expect(decryptString(cipher, KEY)).toBe('secret-value');
    expect(() => decryptString(`${cipher.slice(0, -4)}aaaa`, KEY)).toThrow(Error);
    expect(() => decryptString('nope', KEY)).toThrow(/could not be read/);
    expect(() => encryptString('value', 'abcd')).toThrow(/32 bytes/);
  });
});

describe('passwords', () => {
  it('rejects a different password', async () => {
    const hash = await hashPassword('smsvio-phase1-pass');
    expect(await verifyPassword(hash, 'smsvio-phase1-pass')).toBe(true);
    expect(await verifyPassword(hash, 'other-password-value')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'smsvio-phase1-pass')).toBe(false);
  });
});

describe('cookies', () => {
  it('marks cookies secure only for https origins', () => {
    expect(cookieSecure('https://smsvio.com')).toBe(true);
    expect(cookieSecure('http://localhost:3000')).toBe(false);
  });

  it('clears the organization cookie when there is no active organization', () => {
    const reply = { setCookie: vi.fn(), clearCookie: vi.fn() };
    applySessionCookies(reply as never, false, 'session', 'csrf', null);
    applySessionCookies(reply as never, true, 'session', 'csrf', 'org-id');
    clearAuthCookies(reply as never, true);
    expect(reply.clearCookie).toHaveBeenCalled();
    expect(reply.setCookie).toHaveBeenCalled();
  });
});

describe('rate limits', () => {
  it('computes a retry delay from the oldest hit', () => {
    expect(decideRateLimit(1, 2, null, 1_000, 60_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(decideRateLimit(3, 2, null, 1_000, 60_000).allowed).toBe(false);
    expect(decideRateLimit(3, 2, 1_000, 2_000, 60_000).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rejects when the window is full and when Redis is unavailable', async () => {
    const redis = {
      multi: () => {
        const chain = {
          zremrangebyscore: () => chain,
          zadd: () => chain,
          zcard: () => chain,
          pexpire: () => chain,
          exec: () =>
            Promise.resolve([
              [null, 0],
              [null, 1],
              [null, 2],
              [null, 1],
            ] as [null, number][]),
        };
        return chain;
      },
      call: () => Promise.resolve(['member', String(Date.now())]),
    };
    const limiter = new RateLimiter(redis as never);
    await expect(limiter.enforce('ip:test', 1, 60_000)).rejects.toMatchObject({ status: 429 });

    const down = {
      multi: () => ({
        zremrangebyscore: () => down.multi(),
        zadd: () => down.multi(),
        zcard: () => down.multi(),
        pexpire: () => down.multi(),
        exec: () => Promise.resolve(null),
      }),
    };
    await expect(new RateLimiter(down as never).hit('x', 1, 1000)).rejects.toMatchObject({
      status: 503,
    });

    const textual = {
      multi: () => {
        const chain = {
          zremrangebyscore: () => chain,
          zadd: () => chain,
          zcard: () => chain,
          pexpire: () => chain,
          exec: () =>
            Promise.resolve([
              [null, 0],
              [null, 1],
              [null, '4'],
              [null, 1],
            ] as [null, number | string][]),
        };
        return chain;
      },
      call: () => Promise.resolve(['member', 'not-a-number']),
    };
    const decision = await new RateLimiter(textual as never).hit('acct', 1, 60_000);
    expect(decision.allowed).toBe(false);
  });
});

describe('mailer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a sink file outside production and strips header newlines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'smsvio-mail-'));
    const mailer = createMailer({ ...testEnv, MAIL_SINK_DIR: directory });
    const rendered = await renderMessage(
      VerifyEmail({ name: 'Ada', url: 'http://localhost:3000/verify-email?token=abc' }),
    );
    await mailer.send({
      to: 'ada@example.com',
      subject: emailSubject('Hello\r\nBcc: x'),
      ...rendered,
    });
    expect(emailSubject('Hello\r\nBcc: x')).toBe('Hello Bcc: x');
    const names = await import('node:fs/promises').then((fs) => fs.readdir(directory));
    const raw = await readFile(join(directory, names[0] ?? ''), 'utf8');
    expect(raw).toContain('ada@example.com');
    await rm(directory, { recursive: true, force: true });
  });

  it('sends through SMTP when no sink is configured', async () => {
    const sendMail = vi.fn(() => Promise.resolve({}));
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const mailer = createMailer({
      ...testEnv,
      SMTP_PORT: 465,
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'secret',
    });
    await mailer.send({
      to: 'ada@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(sendMail).toHaveBeenCalledOnce();
  });
});
