import { z } from 'zod';

export const livenessReportSchema = z.object({
  status: z.literal('ok'),
});
export type LivenessReport = z.infer<typeof livenessReportSchema>;

export const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().int().nonnegative(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

export const readinessReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), dependencyCheckSchema),
});
export type ReadinessReport = z.infer<typeof readinessReportSchema>;

export interface DependencyProbe {
  readonly name: string;
  readonly check: () => Promise<void>;
}

export interface DependencyFailure {
  readonly name: string;
  readonly error: unknown;
}

export interface ReadinessResult {
  readonly report: ReadinessReport;
  readonly failures: readonly DependencyFailure[];
}

class ProbeTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`${name} check timed out after ${timeoutMs} ms`);
    this.name = 'ProbeTimeoutError';
  }
}

async function withTimeout(probe: DependencyProbe, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProbeTimeoutError(probe.name, timeoutMs));
    }, timeoutMs);
  });
  try {
    await Promise.race([probe.check(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs every probe concurrently with a per-probe timeout. The public report only says up/down;
 * failure details are returned separately so they can be logged without leaking to clients.
 */
export async function checkReadiness(
  probes: readonly DependencyProbe[],
  timeoutMs: number,
  now: () => number = () => performance.now(),
): Promise<ReadinessResult> {
  const failures: DependencyFailure[] = [];
  const entries = await Promise.all(
    probes.map(async (probe): Promise<[string, DependencyCheck]> => {
      const started = now();
      let status: DependencyCheck['status'] = 'up';
      try {
        await withTimeout(probe, timeoutMs);
      } catch (error) {
        status = 'down';
        failures.push({ name: probe.name, error });
      }
      return [probe.name, { status, latencyMs: Math.max(0, Math.round(now() - started)) }];
    }),
  );
  return {
    report: { status: failures.length === 0 ? 'ok' : 'error', checks: Object.fromEntries(entries) },
    failures,
  };
}
