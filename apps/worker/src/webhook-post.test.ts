import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { postWebhook } from './webhook-post.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

vi.mock('node:https', () => ({
  default: { request: vi.fn() },
  request: vi.fn(),
}));

const lookupMock = vi.mocked(lookup);
const requestMock = vi.mocked(https.request);

describe('postWebhook', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    requestMock.mockReset();
  });

  it('pins the resolved address and returns the status', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    requestMock.mockImplementation(((
      options: {
        lookup?: (
          host: string,
          optionsOrCallback: unknown,
          done?: (error: null, address: string, family: number) => void,
        ) => void;
      },
      callback: (response: EventEmitter) => void,
    ) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error?: Error) => void;
      };
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          resume: () => void;
        };
        response.statusCode = 204;
        response.resume = () => undefined;
        callback(response);
      };
      request.destroy = () => undefined;
      const pinned = options.lookup;
      pinned?.('hooks.example.com', {}, (error, address) => {
        expect(error).toBeNull();
        expect(address).toBe('8.8.8.8');
      });
      pinned?.('hooks.example.com', (_error: null, address: string) => {
        expect(address).toBe('8.8.8.8');
      });
      return request as never;
    }) as never);
    const result = await postWebhook(
      'https://hooks.example.com/sms',
      { 'webhook-id': 'evt_1' },
      '{}',
    );
    expect(result.status).toBe(204);
  });

  it('rejects a private address returned by DNS', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.1.1', family: 4 }] as never);
    await expect(postWebhook('https://hooks.example.com/sms', {}, '{}')).rejects.toThrow(
      /not allowed/,
    );
  });

  it('rejects a URL that is not HTTPS', async () => {
    await expect(postWebhook('http://hooks.example.com/sms', {}, '{}')).rejects.toThrow(/HTTPS/);
  });
});
