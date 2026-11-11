const E164 = /^\+[1-9]\d{7,14}$/;

/** Quick shape check for forms. Contacts and lookup confirm the number with libphonenumber. */
export function isE164(value: string): boolean {
  return E164.test(value);
}

/** Hides the middle digits. Short values collapse so a fragment cannot be recovered. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) {
    return '••••';
  }
  const prefix = value.trim().startsWith('+') ? '+' : '';
  return `${prefix}${digits.slice(0, 3)}••••${digits.slice(-2)}`;
}

export function isValidTimeZone(value: string): boolean {
  if (value.trim() === '' || value.length > 100) {
    return false;
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
