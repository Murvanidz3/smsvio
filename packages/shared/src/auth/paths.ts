const AUTH_PATHS = new Set([
  '/signin',
  '/signup',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
]);

/**
 * Returns a same-origin relative path, or null when the value could redirect off-site
 * or back into an auth page (which would loop).
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed === '' ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\')
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed, 'http://smsvio.local');
  } catch {
    return null;
  }
  if (url.origin !== 'http://smsvio.local' || url.username !== '' || url.password !== '') {
    return null;
  }
  if (url.pathname.startsWith('//') || AUTH_PATHS.has(url.pathname)) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
