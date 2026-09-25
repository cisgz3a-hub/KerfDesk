// A deliberately small QR Code reader for tests: it takes a module grid (not
// an image), reads the format and version words against the published
// tables, unmasks, walks the codeword zig-zag, de-interleaves blocks with the
// published error-correction table, requires every Reed-Solomon syndrome to
// be zero and parses numeric, alphanumeric and byte segments. It shares no
// tables or helpers with the encoder, so an encoder slip cannot hide itself.

import {
  PUBLISHED_ALIGNMENT_CENTRES,
  PUBLISHED_FORMAT_STRINGS,
  PUBLISHED_VERSION_STRINGS,
  publishedEcRow,
} from './qr-published-tables';

type Level = 'L' | 'M' | 'Q' | 'H';

export type QrDecodeResult =
  | {
      readonly ok: true;
      readonly version: number;
      readonly level: Level;
      readonly mask: number;
      readonly text: string;
    }
  | { readonly ok: false; readonly reason: string };

type Grid = { readonly size: number; readonly at: (x: number, y: number) => number };

export function decodeQrModules(modules: ArrayLike<number>, size: number): QrDecodeResult {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    return { ok: false, reason: `size ${size} is not a QR Code size` };
  }
  const grid: Grid = { size, at: (x, y) => modules[y * size + x] ?? 0 };
  const format = readFormat(grid);
  if (format === null) return { ok: false, reason: 'format information unreadable' };
  if (version >= 7 && !versionWordsMatch(grid, version)) {
    return { ok: false, reason: 'version information mismatch' };
  }
  const codewords = readCodewords(grid, version, format.mask);
  const data = checkedDataCodewords(codewords, version, format.level);
  if (typeof data === 'string') return { ok: false, reason: data };
  const text = parseSegments(data, version);
  if (text === null) return { ok: false, reason: 'segment data malformed' };
  return { ok: true, version, level: format.level, mask: format.mask, text };
}

function readFormat(grid: Grid): { readonly level: Level; readonly mask: number } | null {
  const size = grid.size;
  let first = '';
  let second = '';
  for (let bit = 14; bit >= 0; bit -= 1) {
    const [x1, y1] = firstFormatPosition(bit);
    first += String(grid.at(x1, y1));
    const [x2, y2] = bit < 8 ? [size - 1 - bit, 8] : [8, size - 15 + bit];
    second += String(grid.at(x2, y2));
  }
  if (first !== second || grid.at(8, size - 8) !== 1) return null;
  for (const level of ['L', 'M', 'Q', 'H'] as const) {
    const mask = PUBLISHED_FORMAT_STRINGS[level].indexOf(first);
    if (mask >= 0) return { level, mask };
  }
  return null;
}

function firstFormatPosition(bit: number): readonly [number, number] {
  if (bit <= 5) return [8, bit];
  if (bit === 6) return [8, 7];
  if (bit === 7) return [8, 8];
  if (bit === 8) return [7, 8];
  return [14 - bit, 8];
}

function versionWordsMatch(grid: Grid, version: number): boolean {
  let lowerLeft = '';
  let upperRight = '';
  for (let bit = 17; bit >= 0; bit -= 1) {
    const across = grid.size - 11 + (bit % 3);
    const down = Math.floor(bit / 3);
    lowerLeft += String(grid.at(down, across));
    upperRight += String(grid.at(across, down));
  }
  const expected = PUBLISHED_VERSION_STRINGS[version];
  return lowerLeft === expected && upperRight === expected;
}

function isFunctionModule(x: number, y: number, size: number, version: number): boolean {
  return (
    inFinderOrTiming(x, y, size) ||
    inVersionInformation(x, y, size, version) ||
    inAlignmentPattern(x, y, version)
  );
}

// Finder patterns with their separators and format areas, plus timing lines.
function inFinderOrTiming(x: number, y: number, size: number): boolean {
  if (x === 6 || y === 6) return true;
  const far = size - 8;
  return (x <= 8 && y <= 8) || (x >= far && y <= 8) || (x <= 8 && y >= far);
}

function inVersionInformation(x: number, y: number, size: number, version: number): boolean {
  return version >= 7 && ((x >= size - 11 && y <= 5) || (y >= size - 11 && x <= 5));
}

function inAlignmentPattern(x: number, y: number, version: number): boolean {
  const centres = PUBLISHED_ALIGNMENT_CENTRES[version] ?? [];
  const last = centres.length - 1;
  // The three centres that would overlap finder patterns carry no pattern.
  const overlapsFinder = (row: number, column: number): boolean =>
    (row === 0 && (column === 0 || column === last)) || (row === last && column === 0);
  return centres.some((cy, row) =>
    centres.some(
      (cx, column) =>
        !overlapsFinder(row, column) && Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2,
    ),
  );
}

function readCodewords(grid: Grid, version: number, mask: number): number[] {
  const size = grid.size;
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (isFunctionModule(x, y, size, version)) continue;
        bits.push(grid.at(x, y) ^ (maskCondition(mask, y, x) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    codewords.push(bits.slice(index, index + 8).reduce((value, bit) => value * 2 + bit, 0));
  }
  return codewords;
}

// ISO/IEC 18004 Table 10, written with i = row and j = column.
function maskCondition(mask: number, i: number, j: number): boolean {
  const conditions = [
    (i + j) % 2 === 0,
    i % 2 === 0,
    j % 3 === 0,
    (i + j) % 3 === 0,
    (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    ((i * j) % 2) + ((i * j) % 3) === 0,
    (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
  ];
  return conditions[mask] === true;
}

function checkedDataCodewords(
  codewords: number[],
  version: number,
  level: Level,
): number[] | string {
  const row = publishedEcRow(version, level);
  const lengths = [
    ...new Array<number>(row.group1Blocks).fill(row.group1Data),
    ...new Array<number>(row.group2Blocks).fill(row.group2Data),
  ];
  const blocks = lengths.map(() => [] as number[]);
  let cursor = 0;
  const longest = Math.max(...lengths);
  for (let index = 0; index < longest; index += 1) {
    lengths.forEach((length, block) => {
      if (index < length) blocks[block]?.push(codewords[cursor++] ?? -1);
    });
  }
  for (let index = 0; index < row.eccPerBlock; index += 1) {
    blocks.forEach((block) => block.push(codewords[cursor++] ?? -1));
  }
  if (blocks.some((block) => !syndromesAreZero(block, row.eccPerBlock))) {
    return 'Reed-Solomon syndrome is not zero';
  }
  return blocks.flatMap((block, index) => block.slice(0, lengths[index]));
}

const EXP: number[] = [];
const LOG: number[] = [];
for (let power = 0, value = 1; power < 255; power += 1) {
  EXP[power] = value;
  LOG[value] = power;
  value = value & 0x80 ? ((value << 1) ^ 0x11d) & 0xff : value << 1;
}

function multiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return EXP[((LOG[left] ?? 0) + (LOG[right] ?? 0)) % 255] ?? 0;
}

// A codeword block is valid when it evaluates to zero at α^0 .. α^(ecc-1).
function syndromesAreZero(block: readonly number[], ecc: number): boolean {
  for (let root = 0; root < ecc; root += 1) {
    let value = 0;
    for (const codeword of block) value = multiply(value, EXP[root] ?? 0) ^ codeword;
    if (value !== 0) return false;
  }
  return true;
}

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function parseSegments(data: readonly number[], version: number): string | null {
  const bits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => (byte >> shift) & 1));
  let cursor = 0;
  const read = (length: number): number => {
    let value = 0;
    for (let index = 0; index < length; index += 1) value = value * 2 + (bits[cursor++] ?? 0);
    return value;
  };
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  let text = '';
  while (cursor + 4 <= bits.length) {
    const mode = read(4);
    if (mode === 0) break;
    const chunk = parseSegment(mode, group, read);
    if (chunk === null) return null;
    text += chunk;
  }
  return text;
}

function parseSegment(
  mode: number,
  group: number,
  read: (length: number) => number,
): string | null {
  if (mode === 1) return readNumeric(read([10, 12, 14][group] ?? 14), read);
  if (mode === 2) return readAlphanumeric(read([9, 11, 13][group] ?? 13), read);
  if (mode === 4) return readBytes(read([8, 16, 16][group] ?? 16), read);
  return null;
}

function readNumeric(count: number, read: (length: number) => number): string {
  let digits = '';
  let left = count;
  for (; left >= 3; left -= 3) digits += String(read(10)).padStart(3, '0');
  if (left === 2) digits += String(read(7)).padStart(2, '0');
  if (left === 1) digits += String(read(4));
  return digits;
}

function readAlphanumeric(count: number, read: (length: number) => number): string {
  let chars = '';
  let left = count;
  for (; left >= 2; left -= 2) {
    const pair = read(11);
    chars += (ALPHANUMERIC[Math.floor(pair / 45)] ?? '?') + (ALPHANUMERIC[pair % 45] ?? '?');
  }
  if (left === 1) chars += ALPHANUMERIC[read(6)] ?? '?';
  return chars;
}

function readBytes(count: number, read: (length: number) => number): string | null {
  const bytes = Uint8Array.from({ length: count }, () => read(8));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
