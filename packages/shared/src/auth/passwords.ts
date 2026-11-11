/**
 * Common passwords, including the short roots used to reject obvious variants such as
 * `password1234`. Comparison is case-insensitive. The list is a blocklist, not a strength meter.
 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '12345678910',
  '0123456789',
  '0987654321',
  '111111',
  '11111111',
  '1111111111',
  '000000',
  '00000000',
  '121212',
  '123123',
  '123123123',
  '654321',
  '666666',
  '696969',
  '7777777',
  '88888888',
  '999999999',
  '1q2w3e4r',
  '1q2w3e4r5t',
  '1qaz2wsx',
  'qwerty',
  'qwerty123',
  'qwerty1234',
  'qwertyuiop',
  'qwertyui',
  'asdfgh',
  'asdfghjkl',
  'zxcvbnm',
  'zxcvbn',
  'password',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'passwords',
  'password1',
  'password12',
  'password123',
  'password1234',
  'letmein',
  'welcome',
  'welcome1',
  'changeme',
  'iloveyou',
  'admin',
  'admin123',
  'administrator',
  'root',
  'login',
  'master',
  'monkey',
  'dragon',
  'shadow',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'soccer',
  'hockey',
  'batman',
  'superman',
  'trustno1',
  'abc123',
  'abcd1234',
  'pass123',
  'secret',
  'guest',
  'access',
  'whatever',
  'qazwsx',
  'michael',
  'jennifer',
  'jordan',
  'harley',
  'ranger',
  'hunter',
  'buster',
  'thomas',
  'robert',
  'daniel',
  'andrew',
  'joshua',
  'charlie',
  'maggie',
  'pepper',
  'ginger',
  'summer',
  'winter',
  'spring',
  'freedom',
  'computer',
  'internet',
  'google',
  'facebook',
  'twitter',
  'linkedin',
  'samsung',
  'pokemon',
  'starwars',
  'corvette',
  'mercedes',
  'ferrari',
  'mustang',
  'chelsea',
  'liverpool',
  'arsenal',
  'barcelona',
  'madrid',
  'love',
  'lovely',
  'hello',
  'hello123',
  'test',
  'testing',
  'temp',
  'temporary',
  'default',
  'sample',
  'demo',
  'smsvio',
]);

const TRAILING_NOISE = /[\d\s!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]+$/u;

/** True when the password, or its obvious trailing-digit variant, is on the common list. */
export function isCommonPassword(password: string): boolean {
  const folded = password.toLowerCase();
  if (COMMON_PASSWORDS.has(folded)) {
    return true;
  }
  const stripped = folded.replace(TRAILING_NOISE, '');
  return stripped !== folded && stripped.length >= 4 && COMMON_PASSWORDS.has(stripped);
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (isCommonPassword(password)) {
    return 'Choose a less common password.';
  }
  return null;
}
