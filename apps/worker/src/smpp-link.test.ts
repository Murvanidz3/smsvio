import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { ScriptedSocket, SmppPool, type SocketLike } from './smpp-link.js';

const config = {
  host: 'smpp.example',
  port: 2775,
  systemId: 'sys',
  password: 'secret',
  systemType: '',
  sourceTon: 5,
  sourceNpi: 0,
  window: 10,
};

describe('SMPP session', () => {
  it('binds, submits, and keeps a delivery receipt to drain', async () => {
    const pool = new SmppPool(() => {
      return new ScriptedSocket((pdu, socket) => {
        if (pdu.commandId === 0x00000009) {
          socket.emit('data', frame(0x80000009, 0, pdu.sequence, Buffer.alloc(0)));
        }
        if (pdu.commandId === 0x00000004) {
          socket.emit('data', frame(0x80000004, 0, pdu.sequence, cstring('mid-1')));
          socket.emit('data', inboundStop(pdu.sequence + 50));
        }
      });
    });
    const result = await pool.submit('provider-1', config, {
      to: '+491512345678',
      from: 'SMSVIO',
      body: 'Hello',
      encoding: 'GSM-7',
      segments: 1,
    });
    expect(result).toEqual({ status: 'accepted', providerMessageId: 'mid-1' });
    expect(pool.drain().inbound[0]?.body).toBe('STOP');
    pool.close();
  });

  it('reports a temporary failure when the bind is rejected', async () => {
    const pool = new SmppPool(() => {
      return new ScriptedSocket((pdu, socket) => {
        socket.emit('data', frame(0x80000009, 1, pdu.sequence, Buffer.alloc(0)));
      });
    });
    const result = await pool.submit('provider-2', config, {
      to: '+491512345678',
      from: 'SMSVIO',
      body: 'Hello',
      encoding: 'GSM-7',
      segments: 1,
    });
    expect(result.status).toBe('temporary_failure');
    pool.close();
  });

  it('keeps a receipt, rejects a full window, and maps submit failures', async () => {
    let release: (() => void) | undefined;
    const pool = new SmppPool(
      () =>
        new ScriptedSocket((pdu, socket) => {
          if (pdu.commandId === 0x00000009) {
            socket.emit('data', frame(0x80000009, 0, pdu.sequence, Buffer.alloc(0)));
          }
          if (pdu.commandId === 0x00000004) {
            const sequence = pdu.sequence;
            release = () => {
              socket.emit('data', frame(0x80000004, 0, sequence, cstring('held')));
            };
          }
        }),
    );
    const narrow = { ...config, window: 1 };
    const first = pool.submit('window', narrow, message);
    await vi.waitFor(() => {
      expect(release).toBeTypeOf('function');
    });
    expect((await pool.submit('window', narrow, message)).status).toBe('temporary_failure');
    release?.();
    expect(await first).toEqual({ status: 'accepted', providerMessageId: 'held' });
    pool.close();

    const outcomes = new SmppPool(
      () =>
        new ScriptedSocket((pdu, socket) => {
          if (pdu.commandId === 0x00000009) {
            socket.emit('data', frame(0x80000009, 0, pdu.sequence, Buffer.alloc(0)));
            return;
          }
          const status = pdu.body.toString('latin1').includes('PERM')
            ? 1
            : pdu.body.toString('latin1').includes('SLOW')
              ? 0x58
              : 0;
          socket.emit(
            'data',
            frame(
              0x80000004,
              status,
              pdu.sequence,
              status === 0 ? Buffer.from([0]) : Buffer.alloc(0),
            ),
          );
          if (status === 0) {
            socket.emit('data', receipt(pdu.sequence + 20));
            socket.emit('data', Buffer.alloc(16, 1));
            socket.end();
          }
        }),
    );
    expect((await outcomes.submit('perm', config, { ...message, body: 'PERM' })).status).toBe(
      'permanent_failure',
    );
    expect((await outcomes.submit('slow', config, { ...message, body: 'SLOW' })).status).toBe(
      'temporary_failure',
    );
    expect(await outcomes.submit('empty', config, { ...message, body: 'OK' })).toEqual({
      status: 'temporary_failure',
      errorCode: 'carrier_rejected',
    });
    outcomes.close();
  });

  it('treats a socket error during bind as a temporary failure', async () => {
    const pool = new SmppPool(() => {
      const socket = new EventEmitter() as EventEmitter & SocketLike;
      socket.write = () => true;
      socket.end = () => undefined;
      socket.destroy = () => {
        socket.emit('close');
      };
      queueMicrotask(() => {
        socket.emit('error', new Error('refused'));
      });
      return socket;
    });
    expect((await pool.submit('dead', config, message)).status).toBe('temporary_failure');
    pool.close();
  });

  it('sends a multi-part message and opens a new session after the link dies', async () => {
    let socket: ScriptedSocket | undefined;
    const pool = new SmppPool(
      () =>
        new ScriptedSocket((pdu, current) => {
          socket = current;
          if (pdu.commandId === 0x00000009) {
            current.emit('data', frame(0x80000009, 0, pdu.sequence, Buffer.alloc(0)));
            return;
          }
          if (pdu.commandId !== 0x00000004) {
            return;
          }
          current.emit(
            'data',
            frame(0x80000004, 0, pdu.sequence, cstring(`part-${String(pdu.sequence)}`)),
          );
        }),
    );
    const sent = await pool.submit('parts', config, { ...message, body: 'A'.repeat(200) });
    expect(sent.status).toBe('accepted');
    socket?.emit('data', receipt(90));
    expect(pool.drain().receipts).toHaveLength(1);
    socket?.end();
    const again = await pool.submit('parts', config, message);
    expect(again.status).toBe('accepted');
    pool.close();
  });
});

const message = {
  to: '+491512345678',
  from: 'SMSVIO',
  body: 'Hello',
  encoding: 'GSM-7',
  segments: 1,
};

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

function receipt(sequence: number): Buffer {
  const text = Buffer.from('id:mid stat:DELIVRD');
  const body = Buffer.concat([
    Buffer.from([0]),
    Buffer.from([1, 1]),
    cstring('49151111'),
    Buffer.from([1, 1]),
    cstring('SMSVIO'),
    Buffer.from([0x04, 0, 0]),
    Buffer.from([0, 0]),
    Buffer.from([1, 0, 0, 0, text.length]),
    text,
  ]);
  return frame(0x00000005, 0, sequence, body);
}

function inboundStop(sequence: number): Buffer {
  const message = Buffer.from('STOP');
  const body = Buffer.concat([
    Buffer.from([0]),
    Buffer.from([1, 1]),
    cstring('49151111'),
    Buffer.from([1, 1]),
    cstring('SMSVIO'),
    Buffer.from([0, 0, 0]),
    Buffer.from([0, 0]),
    Buffer.from([1, 0, 0, 0, message.length]),
    message,
  ]);
  return frame(0x00000005, 0, sequence, body);
}
