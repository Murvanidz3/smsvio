import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions, type LevelWithSilent } from 'pino';

/**
 * Paths removed from every log line. Message bodies, phone numbers and credentials must never be
 * logged (docs/SPEC.md section 11).
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
] as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses a well-formed incoming `x-request-id`, otherwise generates a new UUID. */
export function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

/** Drops the query string so identifiers such as phone numbers in filters never reach the logs. */
export function stripQuery(url: string | undefined): string {
  if (url === undefined) {
    return '';
  }
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

export function requestLogLevel(
  statusCode: number,
  error: Error | undefined,
  quiet = false,
): LevelWithSilent {
  if (error !== undefined || statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return quiet ? 'silent' : 'info';
}

export interface LoggingOptions {
  readonly service: string;
  readonly level: LevelWithSilent;
  /** Paths whose successful requests are not logged automatically (health probes). */
  readonly quietPaths?: readonly string[];
}

type RequestWithId = IncomingMessage & { id?: unknown };

export function pinoHttpOptions(options: LoggingOptions) {
  const quietPaths = new Set(options.quietPaths ?? []);
  return {
    level: options.level,
    base: { service: options.service },
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]' },
    // Decided at response time: Fastify's middleware layer rewrites `req.url` while the request
    // is in flight, so pino-http's start-of-request `autoLogging.ignore` misses quiet paths.
    customLogLevel: (req: IncomingMessage, res: ServerResponse, error?: Error) =>
      requestLogLevel(res.statusCode, error, quietPaths.has(stripQuery(req.url))),
    serializers: {
      req: (req: RequestWithId) => ({
        id: req.id,
        method: req.method,
        url: stripQuery(req.url),
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
  };
}

export function createLoggerModule(options: LoggingOptions) {
  return LoggerModule.forRoot({ pinoHttp: pinoHttpOptions(options) });
}
