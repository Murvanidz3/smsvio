import { describe, expect, it, vi } from 'vitest';

import { checkReadiness, readinessReportSchema, type DependencyProbe } from './health.js';

const up = (name: string): DependencyProbe => ({ name, check: () => Promise.resolve() });
const down = (name: string, error: Error): DependencyProbe => ({
  name,
  check: () => Promise.reject(error),
});

describe('checkReadiness', () => {
  it('reports ok when every dependency is up', async () => {
    const { report, failures } = await checkReadiness([up('postgres'), up('redis')], 1000);
    expect(report.status).toBe('ok');
    expect(report.checks.postgres?.status).toBe('up');
    expect(report.checks.redis?.status).toBe('up');
    expect(failures).toEqual([]);
    expect(readinessReportSchema.parse(report)).toEqual(report);
  });

  it('reports error and returns the failure separately when a dependency is down', async () => {
    const boom = new Error('connection refused');
    const { report, failures } = await checkReadiness([up('postgres'), down('redis', boom)], 1000);
    expect(report.status).toBe('error');
    expect(report.checks.redis?.status).toBe('down');
    expect(report.checks.redis?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(report)).not.toContain('connection refused');
    expect(failures).toEqual([{ name: 'redis', error: boom }]);
  });

  it('marks a probe that exceeds the timeout as down', async () => {
    vi.useFakeTimers();
    try {
      const hanging: DependencyProbe = {
        name: 'postgres',
        check: () => new Promise(() => undefined),
      };
      const pending = checkReadiness([hanging], 250);
      await vi.advanceTimersByTimeAsync(250);
      const { report, failures } = await pending;
      expect(report.checks.postgres?.status).toBe('down');
      expect(String(failures[0]?.error)).toContain('postgres check timed out after 250 ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures latency with the supplied clock', async () => {
    const ticks = [100, 112.6];
    const clock = () => ticks.shift() ?? 0;
    const { report } = await checkReadiness([up('postgres')], 1000, clock);
    expect(report.checks.postgres?.latencyMs).toBe(13);
  });

  it('never reports negative latency', async () => {
    const ticks = [50, 10];
    const { report } = await checkReadiness([up('redis')], 1000, () => ticks.shift() ?? 0);
    expect(report.checks.redis?.latencyMs).toBe(0);
  });
});
