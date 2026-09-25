// QR Code data segmentation (ISO/IEC 18004 §7.4). Text is split into numeric,
// alphanumeric and byte segments by a shortest-bitstream dynamic programme,
// because a character-count field's width depends on the version, the split
// is computed per version group (1-9, 10-26, 27-40). Byte mode carries UTF-8
// without an ECI header, which is what current phone readers expect.

export type QrMode = 'numeric' | 'alphanumeric' | 'byte';

export type QrSegment = {
  readonly mode: QrMode;
  /** Digit values, alphanumeric indices or bytes, in encoding order. */
  readonly values: readonly number[];
};

const MODES: readonly QrMode[] = ['byte', 'alphanumeric', 'numeric'];
const MODE_INDICATOR: Readonly<Record<QrMode, number>> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};
const COUNT_BITS: Readonly<Record<QrMode, readonly [number, number, number]>> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};
export const QR_ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
// Per-character costs in sixths of a bit: 10 bits per 3 digits, 11 bits per 2
// alphanumerics. Whole bits are restored when a segment closes.
const SIXTHS_PER_DIGIT = 20;
const SIXTHS_PER_ALPHANUMERIC = 33;

export function qrCountBits(mode: QrMode, version: number): number {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return COUNT_BITS[mode][group];
}

export function qrSegmentBits(segment: QrSegment, version: number): number {
  const count = segment.values.length;
  const header = 4 + qrCountBits(segment.mode, version);
  if (segment.mode === 'numeric') {
    return header + 10 * Math.floor(count / 3) + ([0, 4, 7][count % 3] ?? 0);
  }
  if (segment.mode === 'alphanumeric') return header + 11 * Math.floor(count / 2) + 6 * (count % 2);
  return header + 8 * count;
}

/** Shortest segmentation of the text for versions in the same count-width group. */
export function qrSegmentsFor(text: string, version: number): readonly QrSegment[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const modes = cheapestModes(chars, version);
  const segments: QrSegment[] = [];
  let start = 0;
  for (let index = 1; index <= chars.length; index += 1) {
    if (index < chars.length && modes[index] === modes[start]) continue;
    segments.push(makeSegment(modes[start] ?? 'byte', chars.slice(start, index)));
    start = index;
  }
  return segments;
}

export function appendQrSegmentBits(bits: number[], segment: QrSegment, version: number): void {
  appendBits(bits, MODE_INDICATOR[segment.mode], 4);
  appendBits(bits, segment.values.length, qrCountBits(segment.mode, version));
  if (segment.mode === 'byte') {
    for (const value of segment.values) appendBits(bits, value, 8);
    return;
  }
  const groupSize = segment.mode === 'numeric' ? 3 : 2;
  for (let index = 0; index < segment.values.length; index += groupSize) {
    const group = segment.values.slice(index, index + groupSize);
    appendBits(bits, groupValue(segment.mode, group), groupBits(segment.mode, group.length));
  }
}

export function appendBits(bits: number[], value: number, length: number): void {
  for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
}

function groupValue(mode: QrMode, group: readonly number[]): number {
  const radix = mode === 'numeric' ? 10 : 45;
  return group.reduce((value, digit) => value * radix + digit, 0);
}

function groupBits(mode: QrMode, length: number): number {
  if (mode === 'numeric') return [0, 4, 7, 10][length] ?? 10;
  return length === 2 ? 11 : 6;
}

function makeSegment(mode: QrMode, chars: readonly string[]): QrSegment {
  if (mode === 'byte')
    return { mode, values: Array.from(new TextEncoder().encode(chars.join(''))) };
  if (mode === 'numeric') return { mode, values: chars.map((char) => Number(char)) };
  return { mode, values: chars.map((char) => QR_ALPHANUMERIC_CHARSET.indexOf(char)) };
}

// cost[m] is the cheapest encoding (in sixths of a bit) of the prefix read so
// far that leaves a segment of mode m open; chosen[i][m] is the mode that
// encoded character i on that path, so a backwards walk recovers each choice.
function cheapestModes(chars: readonly string[], version: number): QrMode[] {
  const head = MODES.map((mode) => (4 + qrCountBits(mode, version)) * 6);
  let cost = [...head];
  const chosen: (QrMode | null)[][] = [];
  for (const char of chars) {
    const extended = MODES.map((mode, index) =>
      canEncode(mode, char) ? (cost[index] ?? Infinity) + charCost(mode, char) : Infinity,
    );
    const step: (QrMode | null)[] = MODES.map((mode, index) =>
      Number.isFinite(extended[index]) ? mode : null,
    );
    const next = [...extended];
    MODES.forEach((_to, to) => {
      MODES.forEach((from, fromIndex) => {
        const closed = Math.ceil((extended[fromIndex] ?? Infinity) / 6) * 6 + (head[to] ?? 0);
        if (step[fromIndex] !== null && closed < (next[to] ?? Infinity)) {
          next[to] = closed;
          step[to] = from;
        }
      });
    });
    chosen.push(step);
    cost = next;
  }
  return walkBack(chosen, cost);
}

function walkBack(
  chosen: readonly (readonly (QrMode | null)[])[],
  cost: readonly number[],
): QrMode[] {
  let best = 0;
  cost.forEach((value, index) => {
    if (Math.ceil(value / 6) < Math.ceil((cost[best] ?? Infinity) / 6)) best = index;
  });
  let open: QrMode = MODES[best] ?? 'byte';
  const modes: QrMode[] = new Array<QrMode>(chosen.length);
  for (let index = chosen.length - 1; index >= 0; index -= 1) {
    const mode = chosen[index]?.[MODES.indexOf(open)] ?? 'byte';
    modes[index] = mode;
    open = mode;
  }
  return modes;
}

function canEncode(mode: QrMode, char: string): boolean {
  if (mode === 'byte') return true;
  if (mode === 'numeric') return char >= '0' && char <= '9' && char.length === 1;
  return char.length === 1 && QR_ALPHANUMERIC_CHARSET.includes(char);
}

function charCost(mode: QrMode, char: string): number {
  if (mode === 'numeric') return SIXTHS_PER_DIGIT;
  if (mode === 'alphanumeric') return SIXTHS_PER_ALPHANUMERIC;
  return new TextEncoder().encode(char).length * 8 * 6;
}
