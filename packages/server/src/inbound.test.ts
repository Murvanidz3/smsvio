import { SEND_QUEUE_KEY } from '@smsvio/shared';
import { describe, expect, it } from 'vitest';

import { applyInbound, attributeInbound } from './inbound.js';

describe('inbound keywords', () => {
  it('attributes the handset to the latest outbound organization', async () => {
    const db = fake();
    expect(await attributeInbound(db as never, '+491511')).toBeNull();
    await db.message.create({
      data: { direction: 'OUTBOUND', to: '+491511', organizationId: 'org-1' },
    });
    expect(await attributeInbound(db as never, '+491511')).toBe('org-1');
  });

  it('opts out, confirms without billing, then opts back in', async () => {
    const db = fake();
    db.contacts.push({ id: 'c1', organizationId: 'org-1', phoneE164: '+491511', optedOut: false });
    const queued: string[] = [];
    const redis = {
      lpush: (key: string, value: string) => {
        expect(key).toBe(SEND_QUEUE_KEY);
        queued.push(value);
        return Promise.resolve(1);
      },
    };
    expect(
      await applyInbound(db as never, redis, 'org-1', {
        from: '+491511',
        to: 'SMSVIO',
        body: 'please STOP',
      }),
    ).toBe('opt_out');
    expect(db.optOuts).toEqual([{ organizationId: 'org-1', phoneE164: '+491511' }]);
    expect(db.contacts[0]?.optedOut).toBe(true);
    expect(db.messages.some((message) => message.direction === 'INBOUND')).toBe(true);
    expect(
      db.messages.some(
        (message) => message.billable === false && (message.body ?? '').includes('unsubscribed'),
      ),
    ).toBe(true);
    expect(queued).toHaveLength(1);
    expect(
      await applyInbound(db as never, redis, 'org-1', {
        from: '+491511',
        to: 'SMSVIO',
        body: 'START',
      }),
    ).toBe('opt_in');
    expect(db.optOuts).toEqual([]);
    expect(db.contacts[0]?.optedOut).toBe(false);
    expect(
      await applyInbound(db as never, redis, 'org-1', {
        from: '+491511',
        to: 'SMSVIO',
        body: 'HELP',
      }),
    ).toBe('help');
    expect(
      await applyInbound(db as never, redis, 'org-1', {
        from: '+491511',
        to: 'SMSVIO',
        body: 'thanks',
      }),
    ).toBe('stored');
    expect(queued).toHaveLength(3);
  });
});

function fake() {
  const messages: {
    id: string;
    organizationId?: string;
    direction?: string;
    to?: string;
    body?: string;
    billable?: boolean;
  }[] = [];
  const replies: {
    id: string;
    category: string;
    keywords: string[];
    body: string;
    protected: boolean;
  }[] = [];
  const optOuts: { organizationId: string; phoneE164: string }[] = [];
  const contacts: { id: string; organizationId: string; phoneE164: string; optedOut: boolean }[] =
    [];
  return {
    messages,
    optOuts,
    contacts,
    message: {
      findFirst: ({ where }: { where: { to: string } }) => {
        const row = [...messages]
          .reverse()
          .find((item) => item.to === where.to && item.direction === 'OUTBOUND');
        return Promise.resolve(
          row?.organizationId === undefined ? null : { organizationId: row.organizationId },
        );
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${String(messages.length)}`, ...data };
        messages.push(row);
        return Promise.resolve(row);
      },
    },
    autoReply: {
      findMany: () => Promise.resolve(replies),
      create: ({ data }: { data: Record<string, unknown> }) => {
        replies.push(data as (typeof replies)[number]);
        return Promise.resolve(data);
      },
    },
    optOut: {
      upsert: ({ create }: { create: { organizationId: string; phoneE164: string } }) => {
        if (!optOuts.some((row) => row.phoneE164 === create.phoneE164)) {
          optOuts.push({ organizationId: create.organizationId, phoneE164: create.phoneE164 });
        }
        return Promise.resolve(create);
      },
      deleteMany: ({ where }: { where: { phoneE164: string } }) => {
        const kept = optOuts.filter((row) => row.phoneE164 !== where.phoneE164);
        optOuts.splice(0, optOuts.length, ...kept);
        return Promise.resolve({ count: 1 });
      },
    },
    contact: {
      findMany: ({ where }: { where: { phoneE164: string } }) =>
        Promise.resolve(contacts.filter((row) => row.phoneE164 === where.phoneE164)),
      update: ({ where, data }: { where: { id: string }; data: { optedOut: boolean } }) => {
        const row = contacts.find((item) => item.id === where.id);
        if (row !== undefined) {
          row.optedOut = data.optedOut;
        }
        return Promise.resolve(row ?? null);
      },
    },
  };
}
