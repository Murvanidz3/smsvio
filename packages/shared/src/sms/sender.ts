export type SenderKind = 'ALPHANUMERIC' | 'NUMERIC';

export interface SenderRules {
  /** From the Country table. Numeric senders stay allowed when this is false. */
  readonly alphanumericAllowed: boolean;
}

export type SenderCheck =
  | { readonly ok: true; readonly kind: SenderKind; readonly value: string }
  | { readonly ok: false; readonly code: 'invalid_sender' };

const ALPHANUMERIC = /^[A-Za-z0-9 ]{3,11}$/;
const NUMERIC = /^[0-9]{1,15}$/;

/** Alphanumeric: 3–11 of letters, digits and spaces, with at least one letter. Numeric: 1–15 digits. */
export function checkSender(value: string, rules?: SenderRules): SenderCheck {
  if (NUMERIC.test(value)) {
    return { ok: true, kind: 'NUMERIC', value };
  }
  if (!ALPHANUMERIC.test(value) || !/[A-Za-z]/.test(value)) {
    return { ok: false, code: 'invalid_sender' };
  }
  if (rules?.alphanumericAllowed === false) {
    return { ok: false, code: 'invalid_sender' };
  }
  return { ok: true, kind: 'ALPHANUMERIC', value };
}
