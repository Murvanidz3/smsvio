import { describe, expect, it } from 'vitest';

import { documentMatches } from './compliance.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('compliance document sniffing', () => {
  it('accepts a file only when the bytes match the declared type', () => {
    expect(documentMatches('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(documentMatches('application/pdf', Buffer.from('nope'))).toBe(false);
    expect(documentMatches('image/png', PNG)).toBe(true);
    expect(documentMatches('image/png', Buffer.from('not a png'))).toBe(false);
    expect(documentMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
    expect(documentMatches('image/jpeg', Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(documentMatches('image/jpeg', Buffer.from([0x00, 0x00, 0x00]))).toBe(false);
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBP', 8, 'ascii');
    expect(documentMatches('image/webp', webp)).toBe(true);
    expect(documentMatches('image/webp', Buffer.from('RIFF'))).toBe(false);
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'ascii');
    expect(documentMatches('image/webp', riff)).toBe(false);
    expect(documentMatches('text/plain', Buffer.from('license'))).toBe(true);
    expect(documentMatches('text/plain', Buffer.from([0x61, 0x00]))).toBe(false);
    expect(documentMatches('application/octet-stream', Buffer.from('license'))).toBe(false);
  });
});
