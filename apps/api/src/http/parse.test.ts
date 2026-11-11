import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { firstQueryValues, parseInput } from './parse.js';

describe('parseInput', () => {
  it('returns the parsed value and keeps the first error for each field', () => {
    expect(parseInput(z.object({ name: z.string() }), { name: 'Ada' })).toEqual({ name: 'Ada' });
    try {
      parseInput(z.string(), 1);
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'validation_error',
        fields: { form: expect.any(String) },
      });
    }
  });
});

describe('firstQueryValues', () => {
  it('keeps the first string and drops empty or non-string values', () => {
    expect(firstQueryValues(null)).toEqual({});
    expect(
      firstQueryValues({
        q: '',
        role: ['ADMIN', 'VIEWER'],
        empty: [''],
        count: 2,
      }),
    ).toEqual({ q: undefined, role: 'ADMIN', empty: undefined });
  });
});
