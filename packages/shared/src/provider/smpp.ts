const BIND_TRANSCEIVER = 0x00000009;
const BIND_TRANSCEIVER_RESP = 0x80000009;
const SUBMIT_SM = 0x00000004;
const SUBMIT_SM_RESP = 0x80000004;
const DELIVER_SM = 0x00000005;
const DELIVER_SM_RESP = 0x80000005;
const ENQUIRE_LINK = 0x00000015;
const ENQUIRE_LINK_RESP = 0x80000015;

const RECEIPTED_MESSAGE_ID = 0x001e;
const MESSAGE_STATE = 0x0427;
const ESME_RTHROTTLED = 0x00000058;

const STATE_NAME: Record<number, 'delivered' | 'undelivered' | 'expired' | 'failed'> = {
  2: 'delivered',
  3: 'expired',
  5: 'undelivered',
  8: 'failed',
};

const TEXT_STATE: Record<string, 'delivered' | 'undelivered' | 'expired' | 'failed'> = {
  DELIVRD: 'delivered',
  UNDELIV: 'undelivered',
  EXPIRED: 'expired',
  REJECTD: 'failed',
  DELETED: 'failed',
};

export interface ParsedPdu {
  readonly commandId: number;
  readonly status: number;
  readonly sequence: number;
  readonly body: Buffer;
}

export interface SmppAddress {
  readonly ton: number;
  readonly npi: number;
}

export interface SmppSubmitInput {
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly encoding: string;
  readonly source: SmppAddress;
  readonly reference: number;
}

export interface SmppDeliver {
  readonly kind: 'receipt' | 'inbound';
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly providerMessageId?: string;
  readonly receiptStatus?: 'delivered' | 'undelivered' | 'expired' | 'failed';
}

/** Reassembles PDUs when TCP splits them. A length outside 16..8192 drops the buffer. */
export class PduFramer {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length >= 16) {
      const length = this.pending.readUInt32BE(0);
      if (length < 16 || length > 8192) {
        this.pending = Buffer.alloc(0);
        return frames;
      }
      if (this.pending.length < length) {
        return frames;
      }
      frames.push(Buffer.from(this.pending.subarray(0, length)));
      this.pending = Buffer.from(this.pending.subarray(length));
    }
    return frames;
  }
}

export function parsePdu(frame: Buffer): ParsedPdu | null {
  if (frame.length < 16 || frame.readUInt32BE(0) !== frame.length) {
    return null;
  }
  return {
    commandId: frame.readUInt32BE(4),
    status: frame.readUInt32BE(8),
    sequence: frame.readUInt32BE(12),
    body: frame.subarray(16),
  };
}

export function encodeBind(
  sequence: number,
  systemId: string,
  password: string,
  systemType = '',
): Buffer {
  return encodePdu(
    BIND_TRANSCEIVER,
    0,
    sequence,
    Buffer.concat([
      cstring(systemId),
      cstring(password),
      cstring(systemType),
      Buffer.from([0x34, 0x00, 0x00]),
      cstring(''),
    ]),
  );
}

export function encodeEnquireLink(sequence: number): Buffer {
  return encodePdu(ENQUIRE_LINK, 0, sequence, Buffer.alloc(0));
}

export function encodeDeliverResponse(sequence: number, status = 0): Buffer {
  return encodePdu(DELIVER_SM_RESP, status, sequence, cstring(''));
}

export function encodeSubmitSm(sequence: number, input: SmppSubmitInput): Buffer[] {
  const unicode = input.encoding !== 'GSM-7';
  const bytes = unicode ? ucs2be(input.body) : Buffer.from(input.body, 'latin1');
  const single = unicode ? 140 : 160;
  const chunk = unicode ? 134 : 153;
  const slices = splitEven(bytes, bytes.length <= single ? bytes.length || 0 : chunk);
  const parts = slices.length === 0 ? [Buffer.alloc(0)] : slices;
  return parts.map((part, index) => {
    const udh =
      parts.length > 1
        ? Buffer.from([0x05, 0x00, 0x03, input.reference & 0xff, parts.length, index + 1])
        : Buffer.alloc(0);
    const message = Buffer.concat([udh, part]);
    const body = Buffer.concat([
      cstring(''),
      Buffer.from([input.source.ton & 0xff, input.source.npi & 0xff]),
      cstring(input.from),
      Buffer.from([0x01, 0x01]),
      cstring(input.to),
      Buffer.from([parts.length > 1 ? 0x40 : 0x00, 0x00, 0x00]),
      cstring(''),
      cstring(''),
      Buffer.from([0x01, 0x00, unicode ? 0x08 : 0x00, 0x00, message.length]),
      message,
    ]);
    return encodePdu(SUBMIT_SM, 0, sequence + index, body);
  });
}

export function submitResponse(pdu: ParsedPdu): { id: string } | 'temporary' | 'permanent' | null {
  if (pdu.commandId !== SUBMIT_SM_RESP) {
    return null;
  }
  if (pdu.status === 0) {
    return { id: readCString(pdu.body, 0)?.value ?? '' };
  }
  if (pdu.status === ESME_RTHROTTLED) {
    return 'temporary';
  }
  return 'permanent';
}

export function parseDeliver(pdu: ParsedPdu): SmppDeliver | null {
  if (pdu.commandId !== DELIVER_SM) {
    return null;
  }
  const reader = new Reader(pdu.body);
  reader.cstring();
  reader.u8();
  reader.u8();
  const from = reader.cstring();
  reader.u8();
  reader.u8();
  const to = reader.cstring();
  const esm = reader.u8();
  reader.u8();
  reader.u8();
  reader.cstring();
  reader.cstring();
  reader.u8();
  reader.u8();
  reader.u8();
  reader.u8();
  const length = reader.u8();
  const message = reader.bytes(length ?? 0);
  if (from === null || to === null || message === null) {
    return null;
  }
  const text = message.toString('latin1');
  const tlvs = readTlvs(reader.rest());
  const idTlv = tlvs.get(RECEIPTED_MESSAGE_ID);
  const stateTlv = tlvs.get(MESSAGE_STATE);
  const textReceipt = parseReceiptText(text);
  const receipt = ((esm ?? 0) & 0x04) !== 0 || idTlv !== undefined || textReceipt !== null;
  if (!receipt) {
    return { kind: 'inbound', from, to, body: text };
  }
  const providerMessageId =
    (idTlv === undefined ? undefined : readCString(idTlv, 0)?.value) ?? textReceipt?.id;
  const receiptStatus =
    (stateTlv === undefined || stateTlv.length < 1 ? undefined : STATE_NAME[stateTlv[0] ?? 0]) ??
    textReceipt?.status;
  if (providerMessageId === undefined || receiptStatus === undefined) {
    return null;
  }
  return { kind: 'receipt', from, to, body: text, providerMessageId, receiptStatus };
}

export function isBindResponse(pdu: ParsedPdu): boolean {
  return pdu.commandId === BIND_TRANSCEIVER_RESP;
}

export function isEnquireResponse(pdu: ParsedPdu): boolean {
  return pdu.commandId === ENQUIRE_LINK_RESP;
}

export function commandNames(): { enquire: number; bind: number } {
  return { enquire: ENQUIRE_LINK, bind: BIND_TRANSCEIVER };
}

function encodePdu(commandId: number, status: number, sequence: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt32BE(commandId >>> 0, 4);
  header.writeUInt32BE(status >>> 0, 8);
  header.writeUInt32BE(sequence >>> 0, 12);
  return Buffer.concat([header, body]);
}

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, 'ascii'), Buffer.from([0])]);
}

function ucs2be(value: string): Buffer {
  const little = Buffer.from(value, 'utf16le');
  const big = Buffer.alloc(little.length);
  for (let index = 0; index < little.length; index += 2) {
    big[index] = little[index + 1] ?? 0;
    big[index + 1] = little[index] ?? 0;
  }
  return big;
}

function splitEven(bytes: Buffer, size: number): Buffer[] {
  if (size <= 0) {
    return [];
  }
  const slices: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    slices.push(bytes.subarray(offset, offset + size));
  }
  return slices;
}

function parseReceiptText(
  text: string,
): { id: string; status: SmppDeliver['receiptStatus'] } | null {
  const id = /id:(\S+)/i.exec(text)?.[1];
  const stat = /stat:([A-Za-z]+)/i.exec(text)?.[1]?.toUpperCase();
  if (id === undefined || stat === undefined) {
    return null;
  }
  const status = TEXT_STATE[stat];
  if (status === undefined) {
    return null;
  }
  return { id, status };
}

function readTlvs(body: Buffer): Map<number, Buffer> {
  const values = new Map<number, Buffer>();
  let offset = 0;
  while (offset + 4 <= body.length) {
    const tag = body.readUInt16BE(offset);
    const length = body.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + length > body.length) {
      break;
    }
    values.set(tag, body.subarray(offset, offset + length));
    offset += length;
  }
  return values;
}

function readCString(body: Buffer, offset: number): { value: string; next: number } | null {
  const end = body.indexOf(0, offset);
  if (end < 0) {
    return null;
  }
  return { value: body.toString('ascii', offset, end), next: end + 1 };
}

class Reader {
  private offset = 0;

  constructor(private readonly body: Buffer) {}

  u8(): number | null {
    if (this.offset >= this.body.length) {
      return null;
    }
    const value = this.body[this.offset];
    this.offset += 1;
    return value ?? null;
  }

  cstring(): string | null {
    const read = readCString(this.body, this.offset);
    if (read === null) {
      return null;
    }
    this.offset = read.next;
    return read.value;
  }

  bytes(length: number): Buffer | null {
    if (this.offset + length > this.body.length) {
      return null;
    }
    const value = this.body.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  rest(): Buffer {
    return this.body.subarray(this.offset);
  }
}
