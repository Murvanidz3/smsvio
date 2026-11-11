import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ApiError } from '../http/api-error.js';
import { createMemoryDb } from '../memory-db.js';
import { LedgerService } from './ledger.service.js';

describe('ledger reservations', () => {
  it('reserves once, charges once, and releases a second hold without changing the sum', async () => {
    const db = createMemoryDb();
    const ledger = new LedgerService(db as never);
    const organization = await db.organization.create({ data: { name: 'Ledger' } });
    const client = { ip: null, userAgent: null };
    await ledger.adjust(
      randomUUID(),
      organization.id,
      { direction: 'credit', amount: 5_000n, reason: 'Opening credit' },
      client,
    );
    const reserved = await ledger.reserve(
      organization.id,
      1_000n,
      { type: 'message', id: 'm1' },
      'Reservation',
    );
    expect(reserved).toEqual({ availableMicros: 4_000n, heldMicros: 1_000n });
    const again = await ledger.reserve(
      organization.id,
      1_000n,
      { type: 'message', id: 'm1' },
      'Reservation',
    );
    expect(again).toEqual(reserved);
    const charged = await ledger.charge(
      organization.id,
      1_000n,
      { type: 'message', id: 'm1' },
      'Accepted',
    );
    expect(charged).toEqual({ availableMicros: 4_000n, heldMicros: 0n });
    const chargedAgain = await ledger.charge(
      organization.id,
      1_000n,
      { type: 'message', id: 'm1' },
      'Accepted',
    );
    expect(chargedAgain).toEqual(charged);
    await expect(
      ledger.release(organization.id, 1_000n, { type: 'message', id: 'm1' }, 'Release'),
    ).rejects.toBeInstanceOf(ApiError);

    await ledger.reserve(organization.id, 500n, { type: 'message', id: 'm2' }, 'Reservation');
    const released = await ledger.release(
      organization.id,
      500n,
      { type: 'message', id: 'm2' },
      'Released',
    );
    expect(released).toEqual({ availableMicros: 4_000n, heldMicros: 0n });
    await expect(
      ledger.reserve(organization.id, 9_000n, { type: 'message', id: 'm3' }, 'Reservation'),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
    await expect(
      ledger.adjust(
        randomUUID(),
        organization.id,
        { direction: 'debit', amount: 9_000n, reason: 'Too much' },
        client,
      ),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
    const check = await ledger.differences();
    expect(check.differences).toEqual([]);
  });
});
