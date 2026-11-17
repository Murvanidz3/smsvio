import { describe, expect, it } from 'vitest';

import {
  adminMessageQuerySchema,
  autoReplySchema,
  complianceBusinessSchema,
  complianceDocumentSchema,
  reviewDecisionSchema,
  useCaseSchema,
} from './schemas.js';

describe('compliance schemas', () => {
  it('accepts a business profile and rejects a bad website', () => {
    expect(
      complianceBusinessSchema.parse({
        legalName: 'Ada LLC',
        address: '1 Main Street',
        website: '',
        registrationCountry: 'GE',
      }).registrationCountry,
    ).toBe('GE');
    expect(
      complianceBusinessSchema.safeParse({
        legalName: 'Ada LLC',
        address: '1 Main Street',
        website: 'not a url',
        registrationCountry: 'GE',
      }).success,
    ).toBe(false);
    expect(
      useCaseSchema.safeParse({ purpose: 'short', sample: 'Hi', optIn: 'short' }).success,
    ).toBe(false);
    expect(
      complianceDocumentSchema.safeParse({
        countryIso2: 'GE',
        kind: 'license',
        filename: 'note.txt',
        contentType: 'text/plain',
        dataBase64: 'aGk=',
      }).success,
    ).toBe(true);
    expect(
      autoReplySchema.parse({ category: 'CUSTOM', keywords: ['hours'], body: 'Open 9 to 5.' })
        .keywords,
    ).toEqual(['hours']);
    expect(reviewDecisionSchema.parse({ decision: 'reject' }).decision).toBe('reject');
    expect(adminMessageQuerySchema.parse({}).pageSize).toBe(25);
    expect(adminMessageQuerySchema.safeParse({ pageSize: 7 }).success).toBe(false);
  });
});
