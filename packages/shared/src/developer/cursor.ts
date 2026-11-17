export function encodeCursor(createdAt: Date, id: string): string {
  return toBase64Url(`${createdAt.toISOString()}|${id}`);
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  if (cursor.length === 0 || cursor.length > 200) {
    return null;
  }
  let text: string;
  try {
    text = fromBase64Url(cursor);
  } catch {
    return null;
  }
  const split = text.lastIndexOf('|');
  if (split <= 0) {
    return null;
  }
  const createdAt = new Date(text.slice(0, split));
  const id = text.slice(split + 1);
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }
  return { createdAt, id };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + pad(value.length);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function pad(length: number): string {
  const remainder = length % 4;
  if (remainder === 0) {
    return '';
  }
  return '='.repeat(4 - remainder);
}
