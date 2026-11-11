import { randomBytes } from 'node:crypto';

import { ARGON2ID_OPTIONS } from '@smsvio/shared';
import argon2 from 'argon2';

const options = {
  type: argon2.argon2id,
  memoryCost: ARGON2ID_OPTIONS.memoryCost,
  timeCost: ARGON2ID_OPTIONS.timeCost,
  parallelism: ARGON2ID_OPTIONS.parallelism,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** A real argon2 hash used when the account does not exist, so the response time stays even. */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}
