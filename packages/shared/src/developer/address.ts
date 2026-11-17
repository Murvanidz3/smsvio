const BLOCKED_V4: readonly (readonly [number, number])[] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

/** True when the address is not a global unicast target for an outbound webhook. */
export function isBlockedDeliveryAddress(address: string): boolean {
  const trimmed = address.trim().toLowerCase();
  if (trimmed === '') {
    return true;
  }
  const mapped = ipv4Tail(trimmed);
  if (mapped !== null) {
    return isBlockedV4(mapped);
  }
  if (trimmed.includes(':')) {
    return isBlockedV6(trimmed);
  }
  return isBlockedV4(trimmed);
}

export interface WebhookTarget {
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
}

export function parseWebhookUrl(
  value: string,
): { ok: true; target: WebhookTarget } | { ok: false; reason: string } {
  if (value.length > 2048) {
    return { ok: false, reason: 'The URL is too long.' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'Enter a valid HTTPS URL.' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook URLs must use HTTPS.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'Webhook URLs cannot include a username or password.' };
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (hostname === '' || isBlockedHostname(hostname)) {
    return { ok: false, reason: 'That host is not allowed.' };
  }
  if (isIpLiteral(hostname) && isBlockedDeliveryAddress(hostname)) {
    return { ok: false, reason: 'That address is not allowed.' };
  }
  const port = url.port === '' ? 443 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'That port is not allowed.' };
  }
  return {
    ok: true,
    target: { hostname, port, path: `${url.pathname}${url.search}` },
  };
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localdomain')
  );
}

function isIpLiteral(hostname: string): boolean {
  return hostname.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isBlockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) {
    return true;
  }
  return BLOCKED_V4.some(([base, bits]) => inCidr(value, base, bits));
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inCidr(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv4Tail(address: string): string | null {
  const marker = address.lastIndexOf(':');
  if (marker < 0 || !address.slice(marker + 1).includes('.')) {
    return null;
  }
  return address.slice(marker + 1);
}

function isBlockedV6(address: string): boolean {
  const groups = expandIpv6(address);
  if (groups === null) {
    return true;
  }
  if (groups[5] === 0xffff && groups.slice(0, 5).every((group) => group === 0)) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    const v4 = `${String((high >> 8) & 0xff)}.${String(high & 0xff)}.${String((low >> 8) & 0xff)}.${String(low & 0xff)}`;
    return isBlockedV4(v4);
  }
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  if (groups.every((group) => group === 0)) {
    return true;
  }
  if (first === 0 && groups.slice(1, 7).every((group) => group === 0) && groups[7] === 1) {
    return true;
  }
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }
  if ((first & 0xff00) === 0xff00) {
    return true;
  }
  if (first === 0x2001 && second === 0x0db8) {
    return true;
  }
  if (first === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) {
    return true;
  }
  return false;
}

function expandIpv6(address: string): number[] | null {
  if (address.includes(':::')) {
    return null;
  }
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const left = parseGroups(halves[0] ?? '');
  const right = parseGroups(halves[1] ?? '');
  if (left === null || right === null) {
    return null;
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) {
    return null;
  }
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function parseGroups(value: string): number[] | null {
  if (value === '') {
    return [];
  }
  const parts = value.split(':');
  const groups: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null;
    }
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}
