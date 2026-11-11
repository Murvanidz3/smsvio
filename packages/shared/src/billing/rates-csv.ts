import { parseUsdToMicros } from './money.js';

export interface RateCsvRow {
  readonly line: number;
  readonly countryIso2: string;
  readonly mccmnc: string | null;
  readonly priceMicros: bigint;
}

export interface RateCsvError {
  readonly line: number;
  readonly message: string;
}

export type RateCsvResult =
  | { readonly ok: true; readonly rows: RateCsvRow[] }
  | { readonly ok: false; readonly errors: RateCsvError[] };

const HEADER = 'country,network,price';
const MAX_ROWS = 500;

/** Operator price import. Duplicate destinations are rejected rather than skipped. */
export function parseRateCsv(text: string): RateCsvResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const errors: RateCsvError[] = [];
  const header = lines[0]?.trim().toLowerCase();
  if (header !== HEADER) {
    return {
      ok: false,
      errors: [{ line: 1, message: 'The first row must be country,network,price.' }],
    };
  }
  const rows: RateCsvRow[] = [];
  const seen = new Set<string>();
  let dataRows = 0;
  lines.slice(1).forEach((raw, index) => {
    if (raw.trim() === '') {
      return;
    }
    dataRows += 1;
    const line = index + 2;
    if (dataRows > MAX_ROWS) {
      errors.push({ line, message: `A file can contain at most ${String(MAX_ROWS)} prices.` });
      return;
    }
    const parts = raw.split(',').map((part) => part.trim());
    if (parts.length !== 3) {
      errors.push({ line, message: 'Each row needs a country, a network, and a price.' });
      return;
    }
    const country = String(parts[0]).toUpperCase();
    const network = String(parts[1]);
    const price = String(parts[2]);
    if (!/^[A-Z]{2}$/.test(country)) {
      errors.push({ line, message: 'Country must be a two-letter code.' });
      return;
    }
    if (network !== '' && !/^\d{5,6}$/.test(network)) {
      errors.push({ line, message: 'Network must be empty or a 5–6 digit MCCMNC.' });
      return;
    }
    const micros = parseUsdToMicros(price);
    if (micros === null || micros === 0n) {
      errors.push({
        line,
        message: 'Price must be a positive USD amount with at most 6 decimals.',
      });
      return;
    }
    const key = `${country}:${network}`;
    if (seen.has(key)) {
      errors.push({ line, message: 'That destination is already in this file.' });
      return;
    }
    seen.add(key);
    rows.push({
      line,
      countryIso2: country,
      mccmnc: network === '' ? null : network,
      priceMicros: micros,
    });
  });
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'The file has no prices.' });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, rows };
}
