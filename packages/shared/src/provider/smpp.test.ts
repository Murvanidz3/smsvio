import { describe, expect, it } from 'vitest';

import {
  PduFramer,
  commandNames,
  encodeBind,
  encodeDeliverResponse,
  encodeEnquireLink,
  encodeSubmitSm,
  isBindResponse,
  isEnquireResponse,
  parseDeliver,
  parsePdu,
  submitResponse,
} from './smpp.js';

function frame(commandId: number, status: number, sequence: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt32BE(commandId, 4);
  header.writeUInt32BE(status, 8);
  header.writeUInt32BE(sequence, 12);
  return Buffer.concat([header, body]);
}

describe('SMPP PDUs', () => {
  it('frames a PDU that arrives in two chunks and drops a corrupt length', () => {
    const pdu = encodeEnquireLink(7);
    const framer = new PduFramer();
    expect(framer.push(pdu.subarray(0, 10))).toEqual([]);
    expect(framer.push(pdu.subarray(10)).map((item) => item.length)).toEqual([pdu.length]);
    expect(framer.push(Buffer.from([0, 0, 0, 1]))).toEqual([]);
    const huge = Buffer.alloc(16);
    huge.writeUInt32BE(8193, 0);
    expect(framer.push(huge)).toEqual([]);
    const mismatch = Buffer.alloc(16);
    mismatch.writeUInt32BE(32, 0);
    expect(parsePdu(mismatch)).toBeNull();
    expect(commandNames()).toEqual({ enquire: 0x00000015, bind: 0x00000009 });
    const enquire = parsePdu(frame(0x80000015, 0, 3, Buffer.alloc(0)));
    const delivered = parsePdu(encodeDeliverResponse(3));
    expect(enquire === null || delivered === null).toBe(false);
    if (enquire !== null && delivered !== null) {
      expect(isEnquireResponse(enquire)).toBe(true);
      expect(isEnquireResponse(delivered)).toBe(false);
      expect(isBindResponse(delivered)).toBe(false);
    }
    const bindResp = parsePdu(frame(0x80000009, 0, 1, Buffer.alloc(0)));
    expect(bindResp === null ? false : isBindResponse(bindResp)).toBe(true);
  });

  it('encodes a transceiver bind and a single-part submit', () => {
    const bind = parsePdu(encodeBind(1, 'sys', 'secret', ''));
    expect(bind?.commandId).toBe(0x00000009);
    expect(bind?.body.toString('ascii')).toContain('sys');
    const [submit] = encodeSubmitSm(4, {
      from: 'SMSVIO',
      to: '491512345678',
      body: 'Hello',
      encoding: 'GSM-7',
      source: { ton: 5, npi: 0 },
      reference: 9,
    });
    const parsed = parsePdu(submit ?? Buffer.alloc(0));
    expect(parsed?.commandId).toBe(0x00000004);
    expect(parsed?.body.includes(0x40)).toBe(false);
  });

  it('sets the UDH bit when the text needs more than one part', () => {
    const parts = encodeSubmitSm(10, {
      from: 'SMSVIO',
      to: '491512345678',
      body: 'A'.repeat(200),
      encoding: 'GSM-7',
      source: { ton: 5, npi: 0 },
      reference: 3,
    });
    expect(parts.length).toBe(2);
    const first = parsePdu(parts[0] ?? Buffer.alloc(0));
    expect(first?.sequence).toBe(10);
    expect(first?.body.includes(0x40)).toBe(true);
  });

  it('reads a submit response and a delivery receipt from TLV and from text', () => {
    const ok = parsePdu(
      frame(0x80000004, 0, 4, Buffer.concat([Buffer.from('abc'), Buffer.from([0])])),
    );
    expect(submitResponse(ok ?? fail())).toEqual({ id: 'abc' });
    const throttledSubmit = parsePdu(frame(0x80000004, 0x58, 4, Buffer.alloc(0)));
    expect(submitResponse(throttledSubmit ?? fail())).toBe('temporary');
    expect(submitResponse(parsePdu(frame(0x80000004, 1, 4, Buffer.alloc(0))) ?? fail())).toBe(
      'permanent',
    );

    const receipt = deliverFrame(0x04, 'id:xyz stat:DELIVRD', [
      tlv(0x001e, Buffer.concat([Buffer.from('xyz'), Buffer.from([0])])),
      tlv(0x0427, Buffer.from([2])),
    ]);
    expect(parseDeliver(parsePdu(receipt) ?? fail())).toMatchObject({
      kind: 'receipt',
      providerMessageId: 'xyz',
      receiptStatus: 'delivered',
    });
    const textOnly = deliverFrame(0x04, 'id:m1 stat:UNDELIV err:001', []);
    expect(parseDeliver(parsePdu(textOnly) ?? fail())?.receiptStatus).toBe('undelivered');
    const inbound = deliverFrame(0x00, 'STOP', []);
    expect(parseDeliver(parsePdu(inbound) ?? fail())).toMatchObject({
      kind: 'inbound',
      body: 'STOP',
    });
    expect(parsePdu(Buffer.alloc(10))).toBeNull();
    expect(submitResponse(parsePdu(encodeEnquireLink(1)) ?? fail())).toBeNull();
    expect(parseDeliver(parsePdu(frame(0x00000005, 0, 1, Buffer.from([0]))) ?? fail())).toBeNull();
    expect(
      parseDeliver(parsePdu(frame(0x00000005, 0, 1, Buffer.alloc(20, 1))) ?? fail()),
    ).toBeNull();
    expect(
      parseDeliver(parsePdu(deliverFrame(0x04, 'id:m1 stat:QUEUED', [])) ?? fail()),
    ).toBeNull();
    expect(
      parseDeliver(
        parsePdu(
          deliverFrame(0x04, 'id:m1 stat:DELIVRD', [Buffer.from([0x00, 0x1e, 0x00, 0x0a])]),
        ) ?? fail(),
      )?.providerMessageId,
    ).toBe('m1');
    expect(
      encodeSubmitSm(1, {
        from: 'A',
        to: '491512345678',
        body: '',
        encoding: 'GSM-7',
        source: { ton: 5, npi: 0 },
        reference: 1,
      }),
    ).toHaveLength(1);
    const unicode = encodeSubmitSm(20, {
      from: '1',
      to: '491512345678',
      body: 'Æ',
      encoding: 'UCS-2',
      source: { ton: 1, npi: 1 },
      reference: 1,
    });
    expect(parsePdu(unicode[0] ?? Buffer.alloc(0))?.body.includes(0x08)).toBe(true);
  });
});

function fail(): never {
  throw new Error('expected a PDU');
}

function tlv(tag: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(tag, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, value]);
}

function deliverFrame(esm: number, text: string, tlvs: Buffer[]): Buffer {
  const message = Buffer.from(text, 'latin1');
  const body = Buffer.concat([
    Buffer.from([0]),
    Buffer.from([1, 1]),
    Buffer.concat([Buffer.from('49151111'), Buffer.from([0])]),
    Buffer.from([1, 1]),
    Buffer.concat([Buffer.from('SMSVIO'), Buffer.from([0])]),
    Buffer.from([esm, 0, 0]),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from([1, 0, 0, 0, message.length]),
    message,
    ...tlvs,
  ]);
  return frame(0x00000005, 0, 9, body);
}
