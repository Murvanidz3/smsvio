import { describe, expect, it } from 'vitest';

import { WEBHOOK_QUEUE_KEY } from '@smsvio/shared';

import { publishCustomerEvent } from './customer-event.js';

describe('publishCustomerEvent', () => {
  it('queues a delivery only for endpoints that subscribe', async () => {
    const queued: string[] = [];
    const created: string[] = [];
    await publishCustomerEvent(
      {
        webhookEndpoint: {
          findMany: () =>
            Promise.resolve([
              { id: 'yes', events: ['message.sent'] },
              { id: 'no', events: ['message.delivered'] },
            ]),
        },
        webhookDelivery: {
          create: ({ data }) => {
            created.push(data.endpointId);
            return Promise.resolve({ id: `delivery-${data.endpointId}` });
          },
        },
      },
      {
        lpush: (_key, value) => {
          queued.push(value);
          return Promise.resolve(1);
        },
      },
      { organizationId: 'org', type: 'message.sent', data: { id: 'm1' } },
    );
    expect(created).toEqual(['yes']);
    expect(queued).toEqual(['delivery-yes']);
    expect(WEBHOOK_QUEUE_KEY).toBe('smsvio:q:webhook.deliver');
  });

  it('does nothing when the queue or the tables are absent', async () => {
    await publishCustomerEvent({}, undefined, {
      organizationId: 'org',
      type: 'message.sent',
      data: { id: 'm1' },
    });
    await publishCustomerEvent(
      { webhookEndpoint: { findMany: () => Promise.resolve([]) } },
      {
        lpush: () => Promise.resolve(1),
      },
      { organizationId: 'org', type: 'message.sent', data: {} },
    );
  });
});
