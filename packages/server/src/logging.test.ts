import type { IncomingMessage, ServerResponse } from 'node:http';

import { LoggerModule } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import {
  createLoggerModule,
  LOG_REDACT_PATHS,
  pinoHttpOptions,
  requestLogLevel,
  resolveRequestId,
  stripQuery,
} from './logging.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a well-formed incoming id', () => {
    expect(resolveRequestId('req_0123456789abcdef')).toBe('req_0123456789abcdef');
  });

  it('uses the first value of a repeated header', () => {
    expect(resolveRequestId(['abcdefgh-1', 'ignored-123'])).toBe('abcdefgh-1');
  });

  it.each([undefined, '', 'short', 'has spaces in it', 'x'.repeat(129), 'inject\nnewline'])(
    'generates a UUID for %j',
    (header) => {
      expect(resolveRequestId(header)).toMatch(UUID);
    },
  );
});

describe('stripQuery', () => {
  it.each([
    [undefined, ''],
    ['/api/v1/messages', '/api/v1/messages'],
    ['/api/v1/messages?to=%2B995555123456', '/api/v1/messages'],
    ['/?', '/'],
  ])('%j -> %j', (input, expected) => {
    expect(stripQuery(input)).toBe(expected);
  });
});

describe('requestLogLevel', () => {
  it.each([
    [200, undefined, 'info'],
    [302, undefined, 'info'],
    [404, undefined, 'warn'],
    [500, undefined, 'error'],
    [200, new Error('boom'), 'error'],
  ] as const)('status %i with error %s -> %s', (status, error, level) => {
    expect(requestLogLevel(status, error)).toBe(level);
  });

  it.each([
    [200, undefined, 'silent'],
    [404, undefined, 'warn'],
    [503, undefined, 'error'],
    [200, new Error('boom'), 'error'],
  ] as const)('quiet path with status %i and error %s -> %s', (status, error, level) => {
    expect(requestLogLevel(status, error, true)).toBe(level);
  });
});

describe('pinoHttpOptions', () => {
  const options = pinoHttpOptions({ service: 'api', level: 'info', quietPaths: ['/healthz'] });
  const request = (url: string) =>
    ({ url, method: 'GET', id: 'abc' }) as unknown as IncomingMessage;

  it('redacts credentials and tags the service', () => {
    expect(options.redact.paths).toEqual([...LOG_REDACT_PATHS]);
    expect(options.redact.paths).toContain('req.headers.authorization');
    expect(options.base).toEqual({ service: 'api' });
  });

  it('silences only successful requests to quiet paths', () => {
    const ok = { statusCode: 200 } as ServerResponse;
    const failed = { statusCode: 503 } as ServerResponse;
    expect(options.customLogLevel(request('/healthz'), ok)).toBe('silent');
    expect(options.customLogLevel(request('/healthz?probe=1'), ok)).toBe('silent');
    expect(options.customLogLevel(request('/healthz'), failed)).toBe('error');
    expect(options.customLogLevel(request('/readyz'), ok)).toBe('info');
  });

  it('serialises requests without query strings or headers', () => {
    expect(options.serializers.req(request('/api/v1/messages?to=123'))).toEqual({
      id: 'abc',
      method: 'GET',
      url: '/api/v1/messages',
    });
    expect(options.serializers.res({ statusCode: 201 } as ServerResponse)).toEqual({
      statusCode: 201,
    });
  });

  it('maps response status to a log level', () => {
    const res = { statusCode: 503 } as ServerResponse;
    expect(options.customLogLevel(request('/'), res)).toBe('error');
  });

  it('logs every path when no quiet paths are configured', () => {
    const noisy = pinoHttpOptions({ service: 'worker', level: 'debug' });
    expect(noisy.customLogLevel(request('/healthz'), { statusCode: 200 } as ServerResponse)).toBe(
      'info',
    );
  });
});

describe('createLoggerModule', () => {
  it('returns a configured nestjs-pino module', () => {
    expect(createLoggerModule({ service: 'api', level: 'info' }).module).toBe(LoggerModule);
  });
});
