// Data Matrix ECC 200 encoder (ISO/IEC 16022) for square symbols 10x10 to
// 144x144. Text is encoded with ASCII encodation — digit pairs share one
// codeword and Latin-1 characters above 127 use Upper Shift — which every
// reader supports. The smallest square symbol that holds the codewords wins.

import { DATA_MATRIX_FIELD, reedSolomonGenerator, reedSolomonRemainder } from './reed-solomon';
import {
  DATA_MATRIX_FIXED_DARK,
  DATA_MATRIX_FIXED_LIGHT,
  dataMatrixPlacement,
} from './data-matrix-placement';

export type DataMatrixSize = {
  readonly size: number;
  /** Data region edge in modules, finder and clock excluded. */
  readonly regionSize: number;
  /** Regions per side. */
  readonly regions: number;
  readonly dataCodewords: number;
  readonly eccCodewords: number;
  readonly blocks: number;
};

// ISO/IEC 16022 Table 7, square ECC 200 symbols.
// prettier-ignore
const SIZES: readonly (readonly [number, number, number, number, number, number])[] = [
  [10, 8, 1, 3, 5, 1], [12, 10, 1, 5, 7, 1], [14, 12, 1, 8, 10, 1], [16, 14, 1, 12, 12, 1],
  [18, 16, 1, 18, 14, 1], [20, 18, 1, 22, 18, 1], [22, 20, 1, 30, 20, 1], [24, 22, 1, 36, 24, 1],
  [26, 24, 1, 44, 28, 1], [32, 14, 2, 62, 36, 1], [36, 16, 2, 86, 42, 1], [40, 18, 2, 114, 48, 1],
  [44, 20, 2, 144, 56, 1], [48, 22, 2, 174, 68, 1], [52, 24, 2, 204, 84, 2], [64, 14, 4, 280, 112, 2],
  [72, 16, 4, 368, 144, 4], [80, 18, 4, 456, 192, 4], [88, 20, 4, 576, 224, 4], [96, 22, 4, 696, 272, 4],
  [104, 24, 4, 816, 336, 6], [120, 18, 6, 1050, 408, 6], [132, 20, 6, 1304, 496, 8],
  [144, 22, 6, 1558, 620, 10],
];

export const DATA_MATRIX_SIZES: readonly DataMatrixSize[] = SIZES.map(
  ([size, regionSize, regions, dataCodewords, eccCodewords, blocks]) => ({
    size,
    regionSize,
    regions,
    dataCodewords,
    eccCodewords,
    blocks,
  }),
);

export type DataMatrixSymbol = {
  readonly size: number;
  /** Row-major, 1 = dark. */
  readonly modules: Uint8Array;
};

export type DataMatrixEncodeResult =
  | { readonly ok: true; readonly symbol: DataMatrixSymbol; readonly codewords: Uint8Array }
  | { readonly ok: false; readonly message: string };

const PAD = 129;
const UPPER_SHIFT = 235;

export function encodeDataMatrix(text: string): DataMatrixEncodeResult {
  const data = dataMatrixAsciiCodewords(text);
  if (data === null) {
    return {
      ok: false,
      message: 'Data Matrix here supports Latin-1 text only. Use QR Code for other characters.',
    };
  }
  const size = DATA_MATRIX_SIZES.find((candidate) => candidate.dataCodewords >= data.length);
  if (size === undefined) {
    return {
      ok: false,
      message: `Too much data for a Data Matrix (${data.length} of ${maxCapacity()} codewords). Shorten the text.`,
    };
  }
  const codewords = dataMatrixCodewords(padDataMatrix(data, size.dataCodewords), size);
  return { ok: true, symbol: assembleSymbol(codewords, size), codewords };
}

function maxCapacity(): number {
  return DATA_MATRIX_SIZES[DATA_MATRIX_SIZES.length - 1]?.dataCodewords ?? 0;
}

/** ASCII encodation, or null when a character is outside Latin-1. */
export function dataMatrixAsciiCodewords(text: string): number[] | null {
  const codes = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  const codewords: number[] = [];
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;
    const next = codes[index + 1];
    if (isDigit(code) && next !== undefined && isDigit(next)) {
      codewords.push(130 + (code - 48) * 10 + (next - 48));
      index += 1;
    } else if (code <= 127) {
      codewords.push(code + 1);
    } else if (code <= 255) {
      codewords.push(UPPER_SHIFT, code - 127);
    } else {
      return null;
    }
  }
  return codewords;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** First pad is 129; later pads use the 253-state randomising algorithm. */
export function padDataMatrix(data: readonly number[], capacity: number): number[] {
  const padded = [...data];
  if (padded.length < capacity) padded.push(PAD);
  while (padded.length < capacity) {
    const position = padded.length + 1;
    const value = PAD + ((149 * position) % 253) + 1;
    padded.push(value <= 254 ? value : value - 254);
  }
  return padded;
}

/** Data followed by check codewords; multi-block symbols interleave every nth codeword. */
export function dataMatrixCodewords(data: readonly number[], size: DataMatrixSize): Uint8Array {
  const eccPerBlock = size.eccCodewords / size.blocks;
  const generator = reedSolomonGenerator(DATA_MATRIX_FIELD, eccPerBlock, 1);
  const result = new Uint8Array(size.dataCodewords + size.eccCodewords);
  result.set(data);
  for (let block = 0; block < size.blocks; block += 1) {
    const blockData = data.filter((_value, index) => index % size.blocks === block);
    const ecc = reedSolomonRemainder(DATA_MATRIX_FIELD, blockData, generator);
    ecc.forEach((value, index) => {
      result[size.dataCodewords + index * size.blocks + block] = value;
    });
  }
  return result;
}

function assembleSymbol(codewords: Uint8Array, size: DataMatrixSize): DataMatrixSymbol {
  const mappingSize = size.regionSize * size.regions;
  const placement = dataMatrixPlacement(mappingSize, mappingSize);
  const modules = new Uint8Array(size.size * size.size);
  const block = size.regionSize + 2;
  for (let y = 0; y < size.size; y += 1) {
    for (let x = 0; x < size.size; x += 1) {
      const localX = x % block;
      const localY = y % block;
      let dark: boolean;
      if (localX === 0 || localY === block - 1) dark = true;
      else if (localY === 0) dark = localX % 2 === 0;
      else if (localX === block - 1) dark = localY % 2 === 1;
      else {
        const mappingRow = Math.floor(y / block) * size.regionSize + localY - 1;
        const mappingColumn = Math.floor(x / block) * size.regionSize + localX - 1;
        dark = mappingBit(placement[mappingRow * mappingSize + mappingColumn] ?? 0, codewords);
      }
      modules[y * size.size + x] = dark ? 1 : 0;
    }
  }
  return { size: size.size, modules };
}

function mappingBit(entry: number, codewords: Uint8Array): boolean {
  if (entry === DATA_MATRIX_FIXED_DARK) return true;
  if (entry === DATA_MATRIX_FIXED_LIGHT || entry < 0) return false;
  const codeword = codewords[entry >> 3] ?? 0;
  return ((codeword >> (7 - (entry & 7))) & 1) === 1;
}
