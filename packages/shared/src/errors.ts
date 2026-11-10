import { EnvValidationError } from './env.js';

/** Readable text for any thrown value, for logs. Never send the result to clients. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    // JSON.stringify returns undefined for undefined, functions and symbols.
    const json = JSON.stringify(error) as string | undefined;
    return json ?? String(error);
  } catch {
    return String(error);
  }
}

/** Message printed to stderr when a process fails during startup. */
export function startupFailureMessage(service: string, error: unknown): string {
  if (error instanceof EnvValidationError) {
    return error.message;
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : errorMessage(error);
  return `${service} failed to start: ${detail}`;
}
