import type { SmsEncoding } from './encoding.js';

export interface SmsFixture {
  readonly id: string;
  readonly text: string;
  readonly smartEncoding: boolean;
  readonly maxSegments: number;
  readonly encoding: SmsEncoding;
  readonly segmentCount: number;
  readonly tooLong: boolean;
}

/** Spec rule for messages whose every character is one septet. Not used by the segmenter. */
function gsmCount(septets: number): number {
  if (septets === 0) {
    return 0;
  }
  if (septets <= 160) {
    return 1;
  }
  return Math.ceil(septets / 153);
}

/** Spec rule for UCS-2 messages with no surrogate pair on a boundary. */
function ucsCount(units: number): number {
  if (units <= 70) {
    return 1;
  }
  return Math.ceil(units / 67);
}

function plain(
  id: string,
  text: string,
  encoding: SmsEncoding,
  count: number,
  max = 10,
): SmsFixture {
  return {
    id,
    text,
    smartEncoding: false,
    maxSegments: max,
    encoding,
    segmentCount: count,
    tooLong: count > max,
  };
}

const GSM_LENGTHS = [
  0, 1, 2, 3, 50, 100, 152, 153, 154, 159, 160, 161, 162, 305, 306, 307, 459, 460, 612, 613, 765,
  766, 918, 919, 1071, 1072, 1224, 1225, 1377, 1378, 1530, 1531,
];

const UCS_LENGTHS = [
  1, 67, 68, 69, 70, 71, 72, 134, 135, 201, 268, 335, 402, 469, 536, 603, 670, 671,
];

const generated: SmsFixture[] = [
  ...GSM_LENGTHS.map((length) =>
    plain(`gsm-${String(length)}`, 'a'.repeat(length), 'GSM-7', gsmCount(length)),
  ),
  ...UCS_LENGTHS.map((length) =>
    plain(`ucs-${String(length)}`, 'я'.repeat(length), 'UCS-2', ucsCount(length)),
  ),
  plain('gsm-cap', 'a'.repeat(307), 'GSM-7', gsmCount(307), 2),
];

const special: SmsFixture[] = [
  {
    id: 'euro',
    text: '€',
    smartEncoding: false,
    maxSegments: 10,
    encoding: 'GSM-7',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'extension-run',
    text: '^{}\\[~]|€',
    smartEncoding: false,
    maxSegments: 10,
    encoding: 'GSM-7',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'smart-quotes',
    text: '“Hello”',
    smartEncoding: true,
    maxSegments: 10,
    encoding: 'GSM-7',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'raw-quotes',
    text: '“Hello”',
    smartEncoding: false,
    maxSegments: 10,
    encoding: 'UCS-2',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'nbsp',
    text: 'a\u00A0b',
    smartEncoding: true,
    maxSegments: 10,
    encoding: 'GSM-7',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'ellipsis',
    text: 'Wait…',
    smartEncoding: true,
    maxSegments: 10,
    encoding: 'GSM-7',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'emoji',
    text: '😀',
    smartEncoding: false,
    maxSegments: 10,
    encoding: 'UCS-2',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'mixed',
    text: 'Hello я',
    smartEncoding: false,
    maxSegments: 10,
    encoding: 'UCS-2',
    segmentCount: 1,
    tooLong: false,
  },
  {
    id: 'newline',
    text: 'line\nnext\r',
    smartEncoding: false,
    maxSegments: 10,
    encoding: 'GSM-7',
    segmentCount: 1,
    tooLong: false,
  },
];

export const SMS_FIXTURES: readonly SmsFixture[] = [...generated, ...special];
