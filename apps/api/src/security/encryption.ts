import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** AES-256-GCM. The version prefix lets a later key be introduced without rewriting old rows. */
export function encryptString(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
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
    version !== VERSION ||
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
