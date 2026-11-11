import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumberType,
} from 'libphonenumber-js/max';

import { TIMEZONE_PREFIXES } from './timezone-prefixes.js';

const TYPE_LABELS: Readonly<Record<PhoneNumberType, string>> = {
  PREMIUM_RATE: 'Premium rate',
  TOLL_FREE: 'Toll-free',
  SHARED_COST: 'Shared cost',
  VOIP: 'VoIP',
  PERSONAL_NUMBER: 'Personal number',
  PAGER: 'Pager',
  UAN: 'UAN',
  VOICEMAIL: 'Voicemail',
  FIXED_LINE_OR_MOBILE: 'Fixed line or mobile',
  FIXED_LINE: 'Fixed line',
  MOBILE: 'Mobile',
};

/** Countries where carriers do not accept alphanumeric sender ids. Seed data only. */
const ALPHANUMERIC_BLOCKED = new Set(['US', 'CA']);
const REGISTRATION_REQUIRED = new Set(['US', 'CA']);

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

export interface CountrySeed {
  readonly iso2: string;
  readonly name: string;
  readonly dialCode: string;
  readonly alphaSenderAllowed: boolean;
  readonly registrationRequired: boolean;
  readonly notes: string | null;
}

export interface NormalizedPhone {
  readonly e164: string;
  readonly countryCode: CountryCode;
  readonly countryName: string;
  readonly dialCode: string;
  readonly international: string;
  readonly national: string;
  readonly type: string;
  readonly region: string | null;
  readonly timeZones: readonly string[];
}

export interface PhoneLookup {
  readonly valid: boolean;
  readonly e164: string | null;
  readonly international: string | null;
  readonly national: string | null;
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly dialCode: string | null;
  readonly type: string | null;
  readonly region: string | null;
  readonly timeZones: readonly string[];
}

export type NormalizeResult =
  | { readonly ok: true; readonly phone: NormalizedPhone }
  | { readonly ok: false; readonly code: 'invalid_number' };

export function isCountryCode(value: string): value is CountryCode {
  return isSupportedCountry(value);
}

export function countrySeedRows(): CountrySeed[] {
  return getCountries()
    .map((iso2) => ({
      iso2,
      name: countryNames.of(iso2) ?? iso2,
      dialCode: getCountryCallingCode(iso2),
      alphaSenderAllowed: !ALPHANUMERIC_BLOCKED.has(iso2),
      registrationRequired: REGISTRATION_REQUIRED.has(iso2),
      notes: ALPHANUMERIC_BLOCKED.has(iso2)
        ? 'Alphanumeric sender ids are not accepted. Use a numeric sender.'
        : null,
    }))
    .sort((left, right) => left.iso2.localeCompare(right.iso2));
}

/** Longest prefix of the E.164 digits in the libphonenumber time-zone map. */
export function timeZonesForE164(e164: string): readonly string[] {
  const digits = e164.replace(/\D/g, '');
  for (let length = digits.length; length >= 1; length -= 1) {
    const zones = TIMEZONE_PREFIXES[digits.slice(0, length)];
    if (zones !== undefined) {
      return zones;
    }
  }
  return [];
}

/**
 * Accepts an international number, or a national number when `country` is set.
 * Invalid and impossible numbers are rejected.
 */
export function normalizePhone(input: string, country?: string): NormalizeResult {
  const parsed = parseInput(input, country);
  if (parsed === null) {
    return { ok: false, code: 'invalid_number' };
  }
  return { ok: true, phone: parsed };
}

export function lookupPhone(input: string, country?: string): PhoneLookup {
  const parsed = parseInput(input, country);
  if (parsed === null) {
    return {
      valid: false,
      e164: null,
      international: null,
      national: null,
      countryCode: null,
      countryName: null,
      dialCode: null,
      type: null,
      region: null,
      timeZones: [],
    };
  }
  return { valid: true, ...parsed };
}

function parseInput(input: string, country: string | undefined): NormalizedPhone | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  let region: CountryCode | undefined;
  if (country !== undefined && country !== '') {
    if (!isSupportedCountry(country)) {
      return null;
    }
    region = country;
  } else if (!trimmed.startsWith('+')) {
    return null;
  }
  const parsed = parsePhoneNumberFromString(trimmed, region);
  if (parsed?.isValid() !== true || parsed.country === undefined) {
    return null;
  }
  const e164 = parsed.number;
  const timeZones = timeZonesForE164(e164);
  const onlyZone = timeZones.length === 1 ? timeZones[0] : undefined;
  const numberType = parsed.getType();
  const typeLabel = numberType === undefined ? undefined : TYPE_LABELS[numberType];
  return {
    e164,
    countryCode: parsed.country,
    countryName: countryNames.of(parsed.country) ?? parsed.country,
    dialCode: parsed.countryCallingCode,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    type: typeLabel ?? 'Unknown',
    region: onlyZone === undefined ? null : zoneCity(onlyZone),
    timeZones,
  };
}

function zoneCity(zone: string): string {
  const city = zone.split('/').pop() ?? zone;
  return city.replaceAll('_', ' ');
}
