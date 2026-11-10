import { describe, expect, it } from 'vitest';

import { EnvValidationError } from './env.js';
import { errorMessage, startupFailureMessage } from './errors.js';

describe('startupFailureMessage', () => {
  it('prints environment problems without a stack trace', () => {
    const error = new EnvValidationError(['DATABASE_URL: required']);
    expect(startupFailureMessage('API', error)).toBe(error.message);
  });

  it('includes the stack for other errors', () => {
    const error = new Error('port in use');
    expect(startupFailureMessage('API', error)).toBe(`API failed to start: ${String(error.stack)}`);
  });

  it('falls back to the message when there is no stack', () => {
    const error = new Error('no stack');
    error.stack = undefined;
    expect(startupFailureMessage('Worker', error)).toBe('Worker failed to start: no stack');
  });

  it('describes non-Error values', () => {
    expect(startupFailureMessage('Worker', 'boom')).toBe('Worker failed to start: boom');
  });
});

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new TypeError('bad input'))).toBe('bad input');
  });

  it('returns strings unchanged', () => {
    expect(errorMessage('timeout')).toBe('timeout');
  });

  it('serialises plain values', () => {
    expect(errorMessage({ code: 'ECONNRESET' })).toBe('{"code":"ECONNRESET"}');
    expect(errorMessage(42)).toBe('42');
  });

  it('falls back to String() when JSON cannot represent the value', () => {
    expect(errorMessage(undefined)).toBe('undefined');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errorMessage(circular)).toBe('[object Object]');
  });
});
