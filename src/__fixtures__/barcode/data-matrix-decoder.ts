// A small Data Matrix ECC 200 reader for tests. It works on a module grid,
// checks every region's finder L and clock tracks, reads codewords with a
// decoder-side walk (structured like ZXing's BitMatrixParser rather than the
// encoder's placement), verifies the Reed-Solomon syndromes over GF(256)/0x12d
// and decodes ASCII encodation. It shares no code with the encoder.

// size: region edge, regions per side, data codewords, check codewords, blocks
// (ISO/IEC 16022 Table 7, square symbols).
const PUBLISHED_SQUARE_SIZES = `
10:8,1,3,5,1 12:10,1,5,7,1 14:12,1,8,10,1 16:14,1,12,12,1 18:16,1,18,14,1 20:18,1,22,18,1
22:20,1,30,20,1 24:22,1,36,24,1 26:24,1,44,28,1 32:14,2,62,36,1 36:16,2,86,42,1
40:18,2,114,48,1 44:20,2,144,56,1 48:22,2,174,68,1 52:24,2,204,84,2 64:14,4,280,112,2
72:16,4,368,144,4 80:18,4,456,192,4 88:20,4,576,224,4 96:22,4,696,272,4 104:24,4,816,336,6
120:18,6,1050,408,6 132:20,6,1304,496,8 144:22,6,1558,620,10`;

type SizeRow = {
  readonly region: number;
  readonly regions: number;
  readonly data: number;
  readonly ecc: number;
  readonly blocks: number;
};

const SIZES = new Map<number, SizeRow>(
  PUBLISHED_SQUARE_SIZES.trim()
    .split(/\s+/)
    .map((entry) => {
      const [size = '', fields = ''] = entry.split(':');
      const [region = 0, regions = 0, data = 0, ecc = 0, blocks = 0] = fields
        .split(',')
        .map(Number);
      return [Number(size), { region, regions, data, ecc, blocks }] as const;
    }),
);

export type DataMatrixDecodeResult =
  | { readonly ok: true; readonly text: string; readonly codewords: number[] }
  | { readonly ok: false; readonly reason: string };

export function decodeDataMatrixModules(
  modules: ArrayLike<number>,
  size: number,
): DataMatrixDecodeResult {
  const row = SIZES.get(size);
  if (row === undefined) return { ok: false, reason: `no square symbol of size ${size}` };
  const at = (x: number, y: number): boolean => modules[y * size + x] === 1;
  if (!finderPatternsValid(at, size, row.region))
    return { ok: false, reason: 'finder or clock damaged' };
  const mappingSize = row.region * row.regions;
  const mapping = (mRow: number, mColumn: number): boolean => {
    const block = row.region + 2;
    const x = Math.floor(mColumn / row.region) * block + (mColumn % row.region) + 1;
    const y = Math.floor(mRow / row.region) * block + (mRow % row.region) + 1;
    return at(x, y);
  };
  const codewords = readCodewords(mapping, mappingSize, row.data + row.ecc);
  if (!blocksValid(codewords, row))
    return { ok: false, reason: 'Reed-Solomon syndrome is not zero' };
  const text = decodeAscii(codewords.slice(0, row.data));
  if (text === null) return { ok: false, reason: 'unsupported encodation' };
  return { ok: true, text, codewords };
}

function finderPatternsValid(
  at: (x: number, y: number) => boolean,
  size: number,
  region: number,
): boolean {
  const block = region + 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const lx = x % block;
      const ly = y % block;
      let expected: boolean | null = null;
      if (lx === 0 || ly === block - 1) expected = true;
      else if (ly === 0) expected = x % 2 === 0;
      else if (lx === block - 1) expected = y % 2 === 1;
      if (expected !== null && at(x, y) !== expected) return false;
    }
  }
  return true;
}

type Mapping = (row: number, column: number) => boolean;

function readCodewords(mapping: Mapping, n: number, count: number): number[] {
  const seen = new Uint8Array(n * n);
  const read = (row: number, column: number): number => {
    let r = row;
    let c = column;
    if (r < 0) {
      r += n;
      c += 4 - ((n + 4) & 0x07);
    }
    if (c < 0) {
      c += n;
      r += 4 - ((n + 4) & 0x07);
    }
    seen[r * n + c] = 1;
    return mapping(r, c) ? 1 : 0;
  };
  const byte = (cells: ReadonlyArray<readonly [number, number]>): number =>
    cells.reduce((value, [r, c]) => (value << 1) | read(r, c), 0);
  const result: number[] = [];
  const visit = (row: number, column: number): void => {
    const inside = row >= 0 && row < n && column >= 0 && column < n;
    if (inside && seen[row * n + column] === 0) result.push(byte(utahCells(row, column)));
  };
  let position: [number, number] = [4, 0];
  const cornersRead = new Set<number>();
  do {
    const [row, column] = position;
    const corner = cornerCells(row, column, n, cornersRead);
    if (corner === null) {
      position = sweep(position, n, visit);
    } else {
      result.push(byte(corner));
      position = [row - 2, column + 2];
    }
  } while (position[0] < n || position[1] < n);
  return result.slice(0, count);
}

// One up-right diagonal followed by one down-left diagonal.
function sweep(
  start: [number, number],
  n: number,
  visit: (row: number, column: number) => void,
): [number, number] {
  let [row, column] = start;
  do {
    visit(row, column);
    row -= 2;
    column += 2;
  } while (row >= 0 && column < n);
  row += 1;
  column += 3;
  do {
    visit(row, column);
    row += 2;
    column -= 2;
  } while (row < n && column >= 0);
  return [row + 3, column + 1];
}

function utahCells(row: number, column: number): Array<readonly [number, number]> {
  return [
    [row - 2, column - 2],
    [row - 2, column - 1],
    [row - 1, column - 2],
    [row - 1, column - 1],
    [row - 1, column],
    [row, column - 2],
    [row, column - 1],
    [row, column],
  ];
}

function cornerCells(
  row: number,
  column: number,
  n: number,
  done: Set<number>,
): Array<readonly [number, number]> | null {
  const e = n - 1;
  const take = (
    id: number,
    cells: Array<readonly [number, number]>,
  ): Array<readonly [number, number]> | null => {
    if (done.has(id)) return null;
    done.add(id);
    return cells;
  };
  if (row === n && column === 0) {
    return take(1, [
      [e, 0],
      [e, 1],
      [e, 2],
      [0, e - 1],
      [0, e],
      [1, e],
      [2, e],
      [3, e],
    ]);
  }
  if (row === n - 2 && column === 0 && (n & 0x03) !== 0) {
    return take(2, [
      [e - 2, 0],
      [e - 1, 0],
      [e, 0],
      [0, e - 3],
      [0, e - 2],
      [0, e - 1],
      [0, e],
      [1, e],
    ]);
  }
  if (row === n + 4 && column === 2 && (n & 0x07) === 0) {
    return take(3, [
      [e, 0],
      [e, e],
      [0, e - 2],
      [0, e - 1],
      [0, e],
      [1, e - 2],
      [1, e - 1],
      [1, e],
    ]);
  }
  if (row === n - 2 && column === 0 && (n & 0x07) === 4) {
    return take(4, [
      [e - 2, 0],
      [e - 1, 0],
      [e, 0],
      [0, e - 1],
      [0, e],
      [1, e],
      [2, e],
      [3, e],
    ]);
  }
  return null;
}

const EXP: number[] = [];
const LOG: number[] = [];
for (let power = 0, value = 1; power < 255; power += 1) {
  EXP[power] = value;
  LOG[value] = power;
  value <<= 1;
  if (value >= 256) value ^= 0x12d;
}

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0;
}

function blocksValid(codewords: readonly number[], row: SizeRow): boolean {
  const eccPerBlock = row.ecc / row.blocks;
  for (let block = 0; block < row.blocks; block += 1) {
    const data = codewords
      .slice(0, row.data)
      .filter((_value, index) => index % row.blocks === block);
    const ecc = Array.from(
      { length: eccPerBlock },
      (_value, index) => codewords[row.data + index * row.blocks + block] ?? -1,
    );
    const word = [...data, ...ecc];
    for (let root = 1; root <= eccPerBlock; root += 1) {
      let value = 0;
      for (const codeword of word) value = multiply(value, EXP[root] ?? 0) ^ codeword;
      if (value !== 0) return false;
    }
  }
  return true;
}

function decodeAscii(data: readonly number[]): string | null {
  let text = '';
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index] ?? 0;
    if (value === 129) break;
    if (value >= 1 && value <= 128) text += String.fromCharCode(value - 1);
    else if (value >= 130 && value <= 229) text += String(value - 130).padStart(2, '0');
    else if (value === 235) {
      index += 1;
      text += String.fromCharCode((data[index] ?? 0) + 127);
    } else return null;
  }
  return text;
}
