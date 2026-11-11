import { z } from 'zod';

import { validationError } from './api-error.js';

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : 'form';
    fields[key] ??= issue.message;
  }
  throw validationError(fields);
}

/** Fastify may repeat a query key. The first value wins. */
export function firstQueryValues(query: unknown): Record<string, string | undefined> {
  if (typeof query !== 'object' || query === null) {
    return {};
  }
  const entries: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      entries[key] = value === '' ? undefined : value;
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      entries[key] = value[0] === '' ? undefined : value[0];
    }
  }
  return entries;
}
