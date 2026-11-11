/** GSM 03.38 basic character set, without the extension escape. */
export const GSM_BASIC_CHARACTERS =
  '@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5' +
  '\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E' +
  '\u00C6\u00E6\u00DF\u00C9 !"#\u00A4%&\'()*+,-./0123456789:;<=>?\u00A1' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00C4\u00D6\u00D1\u00DC\u00A7\u00BF' +
  'abcdefghijklmnopqrstuvwxyz\u00E4\u00F6\u00F1\u00FC\u00E0';

/** Extension-table characters. Each costs two septets and must stay in one segment. */
export const GSM_EXTENSION_CHARACTERS = '^{}\\[~]|\u20AC\u000C';

const GSM_BASIC = codeUnitSet(GSM_BASIC_CHARACTERS);
const GSM_EXTENSION = codeUnitSet(GSM_EXTENSION_CHARACTERS);

const SMART_REPLACEMENTS: Readonly<Record<string, string>> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u00A0': ' ',
  '\u2026': '...',
};

export const DEFAULT_MAX_SEGMENTS = 10;
const GSM_SINGLE = 160;
const GSM_MULTI = 153;
const UCS_SINGLE = 70;
const UCS_MULTI = 67;

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface CharacterFlag {
  readonly index: number;
  readonly character: string;
  readonly effect: 'replaced' | 'unicode';
}

export interface SmartReplacement {
  readonly index: number;
  readonly from: string;
  readonly to: string;
}

export interface MessageAnalysis {
  readonly original: string;
  readonly text: string;
  readonly encoding: SmsEncoding;
  readonly segments: readonly string[];
  readonly segmentCount: number;
  readonly unitsLeft: number;
  readonly unitLimit: number;
  readonly tooLong: boolean;
  readonly maxSegments: number;
  readonly characters: readonly CharacterFlag[];
  readonly replacements: readonly SmartReplacement[];
}

export interface AnalyzeOptions {
  readonly smartEncoding?: boolean;
  readonly maxSegments?: number;
}

/** Septets for one character, or null when it forces UCS-2. */
export function gsmSeptets(character: string): number | null {
  if (GSM_EXTENSION.has(character)) {
    return 2;
  }
  if (GSM_BASIC.has(character)) {
    return 1;
  }
  return null;
}

export function gsmSeptetLength(text: string): number | null {
  let total = 0;
  for (const character of walk(text)) {
    const cost = gsmSeptets(character.character);
    if (cost === null) {
      return null;
    }
    total += cost;
  }
  return total;
}

export function applySmartEncoding(input: string): {
  text: string;
  replacements: SmartReplacement[];
} {
  let text = '';
  const replacements: SmartReplacement[] = [];
  for (const character of walk(input)) {
    const replacement = SMART_REPLACEMENTS[character.character];
    if (replacement === undefined) {
      text += character.character;
      continue;
    }
    replacements.push({ index: character.index, from: character.character, to: replacement });
    text += replacement;
  }
  return { text, replacements };
}

export function analyzeMessage(input: string, options?: AnalyzeOptions): MessageAnalysis {
  const smartEncoding = options?.smartEncoding ?? true;
  const maxSegments = options?.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const applied = smartEncoding
    ? applySmartEncoding(input)
    : { text: input, replacements: [] as SmartReplacement[] };
  const characters = characterFlags(input, smartEncoding);
  const packed = pack(applied.text);
  return {
    original: input,
    text: applied.text,
    encoding: packed.encoding,
    segments: packed.segments,
    segmentCount: packed.segments.length,
    unitsLeft: packed.unitsLeft,
    unitLimit: packed.unitLimit,
    tooLong: packed.segments.length > maxSegments,
    maxSegments,
    characters,
    replacements: applied.replacements,
  };
}

interface Packed {
  readonly encoding: SmsEncoding;
  readonly segments: string[];
  readonly unitsLeft: number;
  readonly unitLimit: number;
}

function pack(text: string): Packed {
  if (text.length === 0) {
    return { encoding: 'GSM-7', segments: [], unitsLeft: GSM_SINGLE, unitLimit: GSM_SINGLE };
  }
  const septets = gsmSeptetLength(text);
  if (septets === null) {
    return packUcs2(text);
  }
  return packGsm(text, septets);
}

function packGsm(text: string, septets: number): Packed {
  if (septets <= GSM_SINGLE) {
    return {
      encoding: 'GSM-7',
      segments: [text],
      unitsLeft: GSM_SINGLE - septets,
      unitLimit: GSM_SINGLE,
    };
  }
  const segments: string[] = [];
  let index = 0;
  let last = '';
  while (index < text.length) {
    let budget = GSM_MULTI;
    const start = index;
    while (index < text.length) {
      const character = characterAt(text, index);
      const cost = GSM_EXTENSION.has(character.character) ? 2 : 1;
      if (cost > budget) {
        break;
      }
      budget -= cost;
      index += character.character.length;
    }
    last = text.slice(start, index);
    segments.push(last);
  }
  const used = septetsIn(last);
  return {
    encoding: 'GSM-7',
    segments,
    unitsLeft: GSM_MULTI - used,
    unitLimit: GSM_MULTI,
  };
}

function packUcs2(text: string): Packed {
  const total = text.length;
  if (total <= UCS_SINGLE) {
    return {
      encoding: 'UCS-2',
      segments: [text],
      unitsLeft: UCS_SINGLE - total,
      unitLimit: UCS_SINGLE,
    };
  }
  const segments: string[] = [];
  let index = 0;
  let last = '';
  while (index < text.length) {
    let end = Math.min(index + UCS_MULTI, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    last = text.slice(index, end);
    segments.push(last);
    index = end;
  }
  return {
    encoding: 'UCS-2',
    segments,
    unitsLeft: UCS_MULTI - last.length,
    unitLimit: UCS_MULTI,
  };
}

function septetsIn(text: string): number {
  let total = 0;
  for (const character of walk(text)) {
    total += GSM_EXTENSION.has(character.character) ? 2 : 1;
  }
  return total;
}

function characterFlags(input: string, smartEncoding: boolean): CharacterFlag[] {
  const flags: CharacterFlag[] = [];
  for (const character of walk(input)) {
    const replacement = SMART_REPLACEMENTS[character.character];
    if (smartEncoding && replacement !== undefined) {
      flags.push({ ...character, effect: 'replaced' });
      continue;
    }
    if (gsmSeptets(character.character) === null) {
      flags.push({ ...character, effect: 'unicode' });
    }
  }
  return flags;
}

interface Walked {
  readonly index: number;
  readonly character: string;
}

function* walk(text: string): Generator<Walked> {
  for (let index = 0; index < text.length;) {
    const character = characterAt(text, index);
    yield character;
    index += character.character.length;
  }
}

function characterAt(text: string, index: number): Walked {
  const code = text.charCodeAt(index);
  const width = isHighSurrogate(code) ? 2 : 1;
  return { index, character: text.slice(index, index + width) };
}

function codeUnitSet(text: string): Set<string> {
  const characters = new Set<string>();
  for (let index = 0; index < text.length; index += 1) {
    characters.add(text.charAt(index));
  }
  return characters;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
