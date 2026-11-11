import { describe, expect, it } from 'vitest';

import { parseCsv } from './csv.js';
import { contactListSchema, importContactsSchema, lookupSchema } from './schemas.js';
import {
  GSM_BASIC_CHARACTERS,
  GSM_EXTENSION_CHARACTERS,
  analyzeMessage,
  gsmSeptetLength,
  gsmSeptets,
} from './encoding.js';
import { SMS_ERRORS, smsErrorMessage } from './errors.js';
import { SMS_FIXTURES } from './fixtures.js';
import {
  countrySeedRows,
  isCountryCode,
  lookupPhone,
  normalizePhone,
  timeZonesForE164,
} from './phone.js';
import { checkSender } from './sender.js';
import {
  TEMPLATE_GALLERY,
  checkTemplate,
  gallerySample,
  nameFromBody,
  renderTemplate,
  templateCanBeSent,
  templateDefinitionSchema,
  templateVariables,
} from './template.js';

const emoji = '😀';

describe('SMS fixtures', () => {
  it('covers the segment boundaries', () => {
    expect(SMS_FIXTURES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(SMS_FIXTURES)('$id', (fixture) => {
    const analysis = analyzeMessage(fixture.text, {
      smartEncoding: fixture.smartEncoding,
      maxSegments: fixture.maxSegments,
    });
    expect(analysis.encoding).toBe(fixture.encoding);
    expect(analysis.segmentCount).toBe(fixture.segmentCount);
    expect(analysis.tooLong).toBe(fixture.tooLong);
    expect(analysis.segments.join('')).toBe(analysis.text);
    for (const segment of analysis.segments) {
      expect(segment.length).toBeGreaterThan(0);
      expect(endsWithLoneSurrogate(segment)).toBe(false);
      if (analysis.encoding === 'GSM-7') {
        const septets = gsmSeptetLength(segment);
        const limit = analysis.segmentCount === 1 ? 160 : 153;
        expect(septets).not.toBeNull();
        expect(septets ?? 0).toBeLessThanOrEqual(limit);
      } else {
        const limit = analysis.segmentCount === 1 ? 70 : 67;
        expect(segment.length).toBeLessThanOrEqual(limit);
      }
    }
  });
});

describe('segmentation edges', () => {
  it('keeps an extension character out of a one-septet gap', () => {
    const text = `${'a'.repeat(305)}€`;
    const analysis = analyzeMessage(text, { smartEncoding: false });
    expect(analysis.segments).toEqual(['a'.repeat(153), 'a'.repeat(152), '€']);
    expect(analysis.tooLong).toBe(false);
  });

  it('does not split an emoji across a UCS-2 boundary', () => {
    const text = `${'я'.repeat(66)}${emoji}${'я'.repeat(3)}`;
    const analysis = analyzeMessage(text, { smartEncoding: false });
    expect(analysis.segmentCount).toBe(2);
    expect(analysis.segments[0]).toBe('я'.repeat(66));
    expect(analysis.segments[1]?.startsWith(emoji)).toBe(true);
  });

  it('counts the basic set as one septet and the extension set as two', () => {
    expect(GSM_BASIC_CHARACTERS).toHaveLength(127);
    expect(codeUnits(GSM_BASIC_CHARACTERS).every((character) => gsmSeptets(character) === 1)).toBe(
      true,
    );
    expect(
      codeUnits(GSM_EXTENSION_CHARACTERS).every((character) => gsmSeptets(character) === 2),
    ).toBe(true);
    expect(gsmSeptets('я')).toBeNull();
    const basic = analyzeMessage(GSM_BASIC_CHARACTERS, { smartEncoding: false });
    expect(basic.encoding).toBe('GSM-7');
    expect(basic.segmentCount).toBe(1);
  });

  it('replaces typographic characters before choosing an encoding', () => {
    const analysis = analyzeMessage('“a” – —\u00A0…', { smartEncoding: true });
    expect(analysis.text).toBe('"a" - - ...');
    expect(analysis.encoding).toBe('GSM-7');
    expect(analysis.characters.some((flag) => flag.effect === 'replaced')).toBe(true);
    const raw = analyzeMessage('“a”', { smartEncoding: false });
    expect(raw.characters.some((flag) => flag.effect === 'unicode')).toBe(true);
  });
});

describe('sender ids', () => {
  it('accepts alphanumeric and numeric senders and applies the country rule', () => {
    expect(checkSender('SMSVIO')).toEqual({ ok: true, kind: 'ALPHANUMERIC', value: 'SMSVIO' });
    expect(checkSender('Vio 1')).toEqual({ ok: true, kind: 'ALPHANUMERIC', value: 'Vio 1' });
    expect(checkSender('14155550100')).toEqual({
      ok: true,
      kind: 'NUMERIC',
      value: '14155550100',
    });
    expect(checkSender('AB')).toEqual({ ok: false, code: 'invalid_sender' });
    expect(checkSender('1234567890123456')).toEqual({ ok: false, code: 'invalid_sender' });
    expect(checkSender('HELLO!', { alphanumericAllowed: true })).toEqual({
      ok: false,
      code: 'invalid_sender',
    });
    expect(checkSender('SMSVIO', { alphanumericAllowed: false })).toEqual({
      ok: false,
      code: 'invalid_sender',
    });
    expect(checkSender('14155550100', { alphanumericAllowed: false }).ok).toBe(true);
  });
});

describe('templates', () => {
  it('renders variables, estimates with samples, and flags marketing opt-out', () => {
    expect(templateVariables('Hi {{name}}, code {{code}} {{name}}')).toEqual(['name', 'code']);
    expect(renderTemplate('Hi {{name}}', { name: 'Ada' })).toEqual({ ok: true, text: 'Hi Ada' });
    expect(renderTemplate('Hi {{name}}', {})).toEqual({
      ok: false,
      code: 'missing_variable',
      missing: ['name'],
    });
    expect(renderTemplate('Hi {{name}}', { name: '' })).toEqual({ ok: true, text: 'Hi ' });
    expect(nameFromBody('  Hello {{name}}  there  ')).toBe('Hello there');
    expect(nameFromBody('{{name}}')).toBe('Untitled template');
    expect(nameFromBody('a'.repeat(60)).endsWith('…')).toBe(true);
    const marketing = checkTemplate({
      body: 'Sale today',
      category: 'MARKETING',
      samples: {},
      smartEncoding: true,
    });
    expect(marketing.optOutMissing).toBe(true);
    const ready = checkTemplate({
      body: '{{name}} reply STOP to opt out',
      category: 'MARKETING',
      samples: { name: 'Ada' },
      smartEncoding: true,
    });
    expect(ready.optOutMissing).toBe(false);
    expect(ready.analysis.text).toBe('Ada reply STOP to opt out');
    expect(ready.missingSamples).toEqual([]);
    const unresolved = checkTemplate({
      body: 'Hi {{name}}',
      category: 'UTILITY',
      samples: {},
      smartEncoding: true,
    });
    expect(unresolved.missingSamples).toEqual(['name']);
    expect(unresolved.analysis.text).toBe('Hi {{name}}');
    expect(templateCanBeSent('APPROVED')).toBe(true);
    expect(templateCanBeSent('DRAFT')).toBe(false);
    expect(gallerySample('sign-in-code')?.category).toBe('AUTHENTICATION');
    expect(gallerySample('missing')).toBeUndefined();
    expect(TEMPLATE_GALLERY.length).toBeGreaterThanOrEqual(6);
    expect(
      templateDefinitionSchema.parse({
        category: 'UTILITY',
        language: 'en',
        body: 'Hi {{name}}',
        samples: { name: 'Ada' },
      }).category,
    ).toBe('UTILITY');
    expect(
      templateDefinitionSchema.safeParse({ category: 'UTILITY', language: 'EN', body: 'Hi' })
        .success,
    ).toBe(false);
  });
});

describe('phone numbers', () => {
  it('normalises international and national input and rejects the rest', () => {
    const parsed = normalizePhone('+14155552671');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.phone.e164).toBe('+14155552671');
      expect(parsed.phone.countryCode).toBe('US');
      expect(parsed.phone.timeZones).toEqual(['America/Los_Angeles']);
      expect(parsed.phone.region).toBe('Los Angeles');
    }
    expect(normalizePhone('4155552671', 'US').ok).toBe(true);
    expect(normalizePhone('4155552671').ok).toBe(false);
    expect(normalizePhone('+12').ok).toBe(false);
    expect(normalizePhone('+14155552671', 'ZZ').ok).toBe(false);
    expect(normalizePhone('   ').ok).toBe(false);
    expect(normalizePhone('+14155552671', '').ok).toBe(true);
    expect(isCountryCode('US')).toBe(true);
    expect(isCountryCode('ZZ')).toBe(false);
    expect(analyzeMessage('Hello').encoding).toBe('GSM-7');
    expect(analyzeMessage('Hello').unitsLeft).toBe(155);
    const lookup = lookupPhone('+14155552671');
    expect(lookup.valid).toBe(true);
    expect(lookup.international).toBe('+1 415 555 2671');
    expect(lookupPhone('nope').valid).toBe(false);
    expect(timeZonesForE164('+14155552671')).toEqual(['America/Los_Angeles']);
    expect(timeZonesForE164('1').length).toBeGreaterThan(1);
    expect(timeZonesForE164('0')).toEqual([]);
    const alaska = lookupPhone('+19075550100');
    expect(alaska.valid).toBe(true);
    expect(alaska.timeZones.length).toBeGreaterThan(1);
    expect(alaska.region).toBeNull();
  });

  it('seeds every country and blocks alphanumeric senders in the US and Canada', () => {
    const rows = countrySeedRows();
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.find((row) => row.iso2 === 'US')).toMatchObject({
      alphaSenderAllowed: false,
      registrationRequired: true,
      dialCode: '1',
    });
    expect(rows.find((row) => row.iso2 === 'GE')).toMatchObject({
      alphaSenderAllowed: true,
      registrationRequired: false,
    });
  });
});

describe('csv', () => {
  it('parses quotes, escaped quotes, and a trailing newline', () => {
    expect(parseCsv('')).toEqual({ ok: true, rows: [] });
    expect(parseCsv('a,b\n')).toEqual({ ok: true, rows: [['a', 'b']] });
    expect(parseCsv('"a,b","c""d"\r\nsecond')).toEqual({
      ok: true,
      rows: [['a,b', 'c"d'], ['second']],
    });
    expect(parseCsv('"open').ok).toBe(false);
    expect(parseCsv('a\n'.repeat(5001)).ok).toBe(false);
    expect(parseCsv(`\uFEFFphone,name\n+14155552671,Ada`).ok).toBe(true);
  });
});

describe('request schemas', () => {
  it('accepts a contact list and rejects a bad page size', () => {
    expect(contactListSchema.parse({}).pageSize).toBe(10);
    expect(contactListSchema.safeParse({ pageSize: '15' }).success).toBe(false);
    expect(lookupSchema.parse({ phone: '+14155552671' }).phone).toBe('+14155552671');
    expect(
      importContactsSchema.parse({
        csv: 'phone',
        hasHeader: true,
        phoneColumn: 0,
        nameColumn: null,
        countryColumn: null,
      }).hasHeader,
    ).toBe(true);
  });
});

describe('error catalogue', () => {
  it('has an explanation for every code', () => {
    for (const code of Object.keys(SMS_ERRORS) as (keyof typeof SMS_ERRORS)[]) {
      expect(smsErrorMessage(code).length).toBeGreaterThan(10);
    }
    expect(smsErrorMessage('message_too_long')).toMatch(/segment/i);
  });
});

function codeUnits(text: string): string[] {
  const units: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    units.push(text.charAt(index));
  }
  return units;
}

function endsWithLoneSurrogate(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff;
}
