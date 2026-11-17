import { encryptString } from '@smsvio/shared/developer';
import { describe, expect, it, vi } from 'vitest';

import { sendThroughProvider, useSmppPool } from './carrier.js';
import { ScriptedSocket, SmppPool } from './smpp-link.js';
import { postCarrier } from './webhook-post.js';

vi.mock('./webhook-post.js', () => ({
  postCarrier: vi.fn(),
}));

const post = vi.mocked(postCarrier);
const key = 'ab'.repeat(32);

const request = {
  to: '+491512345678',
  from: 'SMSVIO',
  body: 'Hello',
  encoding: 'GSM-7',
  segments: 1,
};

describe('carrier selection', () => {
  it('keeps a test send on the mock provider', async () => {
    const result = await sendThroughProvider({
      provider: {
        id: 'p1',
        code: 'smpp-live',
        type: 'SMPP',
        configEnc: null,
        callbackSecretHash: null,
      },
      request,
      billable: false,
      encryptionKey: undefined,
    });
    expect(result.status).toBe('accepted');
  });

  it('does not open a socket when the SMPP config is missing', async () => {
    const result = await sendThroughProvider({
      provider: {
        id: 'p1',
        code: 'smpp-live',
        type: 'SMPP',
        configEnc: null,
        callbackSecretHash: null,
      },
      request,
      billable: true,
      encryptionKey: undefined,
    });
    expect(result).toEqual({ status: 'temporary_failure', errorCode: 'carrier_rejected' });
  });

  it('sends live HTTP traffic and rejects a bad carrier config', async () => {
    post.mockResolvedValue({ status: 202, body: '{"id":"up-1"}' });
    const accepted = await sendThroughProvider({
      provider: http(JSON.stringify({ url: 'https://upstream.example/sms' })),
      request,
      billable: true,
      encryptionKey: key,
    });
    expect(accepted).toEqual({ status: 'accepted', providerMessageId: 'up-1' });

    post.mockRejectedValue(new Error('down'));
    const failed = await sendThroughProvider({
      provider: http(JSON.stringify({ url: 'https://upstream.example/sms' })),
      request,
      billable: true,
      encryptionKey: key,
    });
    expect(failed.status).toBe('temporary_failure');

    const invalid = await sendThroughProvider({
      provider: http(JSON.stringify({ url: 'http://upstream.example/sms' })),
      request,
      billable: true,
      encryptionKey: key,
    });
    expect(invalid.status).toBe('temporary_failure');

    const broken = await sendThroughProvider({
      provider: http('not-json'),
      request,
      billable: true,
      encryptionKey: key,
    });
    expect(broken.status).toBe('temporary_failure');

    const smpp = await sendThroughProvider({
      provider: {
        id: 'p1',
        code: 'smpp-live',
        type: 'SMPP',
        configEnc: encryptString(JSON.stringify({ host: '' }), key),
        callbackSecretHash: null,
      },
      request,
      billable: true,
      encryptionKey: key,
    });
    expect(smpp.status).toBe('temporary_failure');

    useSmppPool(
      new SmppPool(
        () =>
          new ScriptedSocket((pdu, socket) => {
            if (pdu.commandId === 0x00000009) {
              socket.emit('data', frame(0x80000009, 0, pdu.sequence, Buffer.alloc(0)));
            }
            if (pdu.commandId === 0x00000004) {
              socket.emit('data', frame(0x80000004, 0, pdu.sequence, cstring('smpp-1')));
            }
          }),
      ),
    );
    const live = await sendThroughProvider({
      provider: {
        id: 'smpp-1',
        code: 'smpp-live',
        type: 'SMPP',
        configEnc: encryptString(
          JSON.stringify({
            host: 'smpp.example',
            port: 2775,
            systemId: 'sys',
            password: 'secret',
          }),
          key,
        ),
        callbackSecretHash: null,
      },
      request,
      billable: true,
      encryptionKey: key,
    });
    expect(live).toEqual({ status: 'accepted', providerMessageId: 'smpp-1' });
    useSmppPool(new SmppPool());
  });
});

function frame(commandId: number, status: number, sequence: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt32BE(commandId, 4);
  header.writeUInt32BE(status, 8);
  header.writeUInt32BE(sequence, 12);
  return Buffer.concat([header, body]);
}

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value), Buffer.from([0])]);
}

function http(config: string) {
  return {
    id: 'p1',
    code: 'http-live',
    type: 'HTTP',
    configEnc: encryptString(config, key),
    callbackSecretHash: null,
  };
}
