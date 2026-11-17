import { EventEmitter } from 'node:events';
import net from 'node:net';

import {
  PduFramer,
  encodeBind,
  encodeDeliverResponse,
  encodeEnquireLink,
  encodeSubmitSm,
  isBindResponse,
  parseDeliver,
  parsePdu,
  submitResponse,
  type ParsedPdu,
  type ProviderSendRequest,
  type ProviderSendResult,
  type SmppDeliver,
} from '@smsvio/shared/provider';
import { z } from 'zod';

const BIND = 0x00000009;
const ENQUIRE = 0x00000015;
const SUBMIT = 0x00000004;
const TIMEOUT_MS = 8_000;

export const smppConfigSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  systemId: z.string().trim().min(1).max(16),
  password: z.string().min(1).max(16),
  systemType: z.string().max(13).default(''),
  sourceTon: z.number().int().min(0).max(6).default(5),
  sourceNpi: z.number().int().min(0).max(10).default(0),
  window: z.number().int().min(1).max(100).default(10),
});

export type SmppConfig = z.infer<typeof smppConfigSchema>;

export interface SocketLike {
  write(data: Buffer): boolean;
  end(): void;
  destroy(): void;
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close' | 'connect', listener: () => void): this;
}

export type SocketFactory = (port: number, host: string) => SocketLike;

interface CarrierTraffic {
  receipts: SmppDeliver[];
  inbound: SmppDeliver[];
}

/** One transceiver session per provider. A dead session is opened again on the next submit. */
export class SmppPool {
  private readonly links = new Map<string, Link>();

  constructor(private readonly connect: SocketFactory = defaultConnect) {}

  async submit(
    providerId: string,
    config: SmppConfig,
    request: ProviderSendRequest,
  ): Promise<ProviderSendResult> {
    let link = this.links.get(providerId);
    if (link?.alive !== true) {
      link = new Link(config, this.connect);
      try {
        await link.open();
      } catch {
        link.close();
        return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
      }
      this.links.set(providerId, link);
    }
    try {
      return await link.submit(request);
    } catch {
      link.close();
      this.links.delete(providerId);
      return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
    }
  }

  drain(): CarrierTraffic {
    const receipts: SmppDeliver[] = [];
    const inbound: SmppDeliver[] = [];
    for (const link of this.links.values()) {
      receipts.push(...link.receipts.splice(0));
      inbound.push(...link.inbound.splice(0));
    }
    return { receipts, inbound };
  }

  close(): void {
    for (const link of this.links.values()) {
      link.close();
    }
    this.links.clear();
  }
}

class Link {
  alive = false;
  readonly receipts: SmppDeliver[] = [];
  readonly inbound: SmppDeliver[] = [];
  private sequence = 1;
  private readonly framer = new PduFramer();
  private readonly pending = new Map<number, (pdu: ParsedPdu) => void>();
  private socket: SocketLike | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: SmppConfig,
    private readonly connect: SocketFactory,
  ) {}

  async open(): Promise<void> {
    const socket = this.connect(this.config.port, this.config.host);
    this.socket = socket;
    socket.on('data', (chunk) => {
      this.onData(chunk);
    });
    socket.on('error', () => {
      this.fail(new Error('SMPP connection failed.'));
    });
    socket.on('close', () => {
      this.alive = false;
    });
    await waitFor(socket, 'connect');
    const sequence = this.nextSequence();
    const response = this.wait(sequence);
    socket.write(
      encodeBind(sequence, this.config.systemId, this.config.password, this.config.systemType),
    );
    const bound = await response;
    if (!isBindResponse(bound) || bound.status !== 0) {
      throw new Error('SMPP bind was rejected.');
    }
    this.alive = true;
    this.timer = setInterval(() => {
      if (!this.alive || this.socket === null) {
        return;
      }
      this.socket.write(encodeEnquireLink(this.nextSequence()));
    }, 30_000);
    this.timer.unref();
  }

  async submit(request: ProviderSendRequest): Promise<ProviderSendResult> {
    if (this.socket === null || !this.alive) {
      throw new Error('SMPP session is closed.');
    }
    if (this.pending.size >= this.config.window) {
      return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
    }
    const start = this.sequence;
    const pdus = encodeSubmitSm(start, {
      from: request.from,
      to: request.to.replace(/^\+/, ''),
      body: request.body,
      encoding: request.encoding,
      source: { ton: this.config.sourceTon, npi: this.config.sourceNpi },
      reference: start & 0xff,
    });
    this.sequence += pdus.length;
    const waits = pdus.map((_pdu, index) => this.wait(start + index));
    for (const pdu of pdus) {
      this.socket.write(pdu);
    }
    const responses = await Promise.all(waits);
    let id = '';
    for (const pdu of responses) {
      const result = submitResponse(pdu);
      if (result === 'temporary' || result === null) {
        return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
      }
      if (result === 'permanent') {
        return { status: 'permanent_failure', errorCode: 'carrier_rejected' };
      }
      if (id === '') {
        id = result.id;
      }
    }
    if (id === '') {
      return { status: 'temporary_failure', errorCode: 'carrier_rejected' };
    }
    return { status: 'accepted', providerMessageId: id };
  }

  close(): void {
    this.alive = false;
    clearInterval(this.timer);
    this.fail(new Error('SMPP session closed.'));
    this.socket?.destroy();
    this.socket = null;
  }

  private nextSequence(): number {
    const value = this.sequence;
    this.sequence += 1;
    return value;
  }

  private wait(sequence: number): Promise<ParsedPdu> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new Error('SMPP response timed out.'));
      }, TIMEOUT_MS);
      this.pending.set(sequence, (pdu) => {
        clearTimeout(timer);
        resolve(pdu);
      });
    });
  }

  private fail(error: Error): void {
    for (const [sequence, resolve] of this.pending) {
      this.pending.delete(sequence);
      resolve({
        commandId: 0,
        status: 1,
        sequence,
        body: Buffer.from(error.message),
      });
    }
  }

  private onData(chunk: Buffer): void {
    for (const frame of this.framer.push(chunk)) {
      const pdu = parsePdu(frame);
      if (pdu === null) {
        continue;
      }
      const waiting = this.pending.get(pdu.sequence);
      if (waiting !== undefined) {
        this.pending.delete(pdu.sequence);
        waiting(pdu);
        continue;
      }
      if (pdu.commandId === ENQUIRE || pdu.commandId === BIND || pdu.commandId === SUBMIT) {
        continue;
      }
      const delivered = parseDeliver(pdu);
      if (delivered === null || this.socket === null) {
        continue;
      }
      this.socket.write(encodeDeliverResponse(pdu.sequence));
      if (delivered.kind === 'receipt') {
        this.receipts.push(delivered);
      } else {
        this.inbound.push(delivered);
      }
    }
  }
}

function defaultConnect(port: number, host: string): SocketLike {
  return net.connect({ port, host });
}

function waitFor(socket: SocketLike, event: 'connect'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('SMPP connect timed out.'));
    }, TIMEOUT_MS);
    socket.on(event, () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export class ScriptedSocket extends EventEmitter implements SocketLike {
  readonly written: Buffer[] = [];
  private readonly script: (pdu: ParsedPdu, socket: ScriptedSocket) => void;

  constructor(script: (pdu: ParsedPdu, socket: ScriptedSocket) => void) {
    super();
    this.script = script;
    queueMicrotask(() => {
      this.emit('connect');
    });
  }

  write(data: Buffer): boolean {
    this.written.push(Buffer.from(data));
    const pdu = parsePdu(data);
    if (pdu !== null) {
      this.script(pdu, this);
    }
    return true;
  }

  end(): void {
    this.emit('close');
  }

  destroy(): void {
    this.emit('close');
  }
}
