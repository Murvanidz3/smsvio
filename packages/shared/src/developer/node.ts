import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** 32 random bytes, base64url, prefixed so the mode is visible. */
export function createApiKey(mode: 'LIVE' | 'TEST'): string {
  const prefix = mode === 'LIVE' ? 'svk_live_' : 'svk_test_';
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function apiKeyMode(token: string): 'LIVE' | 'TEST' | null {
  if (/^svk_live_[A-Za-z0-9_-]{43}$/.test(token)) {
    return 'LIVE';
  }
  if (/^svk_test_[A-Za-z0-9_-]{43}$/.test(token)) {
    return 'TEST';
  }
  return null;
}

export function apiKeyPrefix(token: string): string {
  return token.slice(0, 16);
}

export function apiKeyLast4(token: string): string {
  return token.slice(-4);
}

export function maskApiKey(prefix: string, last4: string): string {
  return `${prefix}…${last4}`;
}

/** Standard Webhooks secret: `whsec_` plus the base64 of 32 random bytes. */
export function createWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

export function webhookSecretKey(secret: string): Buffer {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 16) {
    throw new Error('Webhook secret is too short.');
  }
  return key;
}

/** `v1,<base64 hmac>` over `id.timestamp.body`, using the decoded secret. */
export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', webhookSecretKey(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${mac}`;
}

const CIPHER_VERSION = 'v1';

/** AES-256-GCM. The version prefix lets a later key be introduced without rewriting old rows. */
export function encryptString(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptString(payload: string, keyHex: string): string {
  const parts = payload.split('.');
  const version = parts[0];
  const iv = parts[1];
  const tag = parts[2];
  const data = parts[3];
  if (
    version !== CIPHER_VERSION ||
    iv === undefined ||
    tag === undefined ||
    data === undefined ||
    parts.length !== 4
  ) {
    throw new Error('Ciphertext could not be read.');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer(keyHex), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function keyBuffer(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes.');
  }
  return key;
}

export function webhookSignaturesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}
