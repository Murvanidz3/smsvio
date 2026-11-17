import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { UsageLoop } from './usage-loop.js';

const env = {
  EMAIL_MODE: 'disabled' as const,
  SMTP_PORT: 587,
};

function idlePrisma() {
  return {
    organization: { findMany: () => Promise.resolve([]) },
    billingProfile: { findMany: () => Promise.resolve([]) },
  };
}

describe('usage loop', () => {
  it('logs a failed pass', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const loop = new UsageLoop(
      { organization: { findMany: () => Promise.reject(new Error('down')) } } as never,
      env as never,
    );
    await loop.tick();
    expect(errorSpy).toHaveBeenCalledWith('Usage pass failed: down');
    loop.onApplicationShutdown();
  });

  it('does not start a second pass while the first is still running', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const prisma = idlePrisma();
    prisma.organization.findMany = () => {
      started += 1;
      return gate.then(() => []);
    };
    const loop = new UsageLoop(prisma as never, env as never);
    const first = loop.tick();
    await loop.tick();
    expect(started).toBe(1);
    release();
    await first;
    loop.onApplicationShutdown();
  });
});
