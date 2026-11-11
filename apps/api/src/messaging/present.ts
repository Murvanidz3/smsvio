import { Prisma } from '@smsvio/db';
import { formatMicros, parseUsdToMicros } from '@smsvio/shared/billing';

import { ApiError } from '../http/api-error.js';

export function presentMoney(micros: bigint, fractionDigits: 2 | 4) {
  return { micros: micros.toString(), display: formatMicros(micros, fractionDigits) };
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'That record does not exist.');
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(400, 'validation_error', 'Check the highlighted fields.', fields);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function requireUsd(value: string, field: string, allowZero: boolean): bigint {
  const micros = parseUsdToMicros(value);
  if (micros === null || (micros === 0n && !allowZero)) {
    throw validation({
      [field]: allowZero
        ? 'Enter an amount from 0 to 1000000 USD.'
        : 'Enter an amount greater than 0 and at most 1000000 USD.',
    });
  }
  return micros;
}
