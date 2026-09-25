import { describe, expect, it } from 'vitest';

import { decodeDataMatrixModules } from '../../__fixtures__/barcode/data-matrix-decoder';
import {
  DATA_MATRIX_SIZES,
  dataMatrixAsciiCodewords,
  dataMatrixCodewords,
  encodeDataMatrix,
  padDataMatrix,
  type DataMatrixSymbol,
} from './data-matrix-encode';
import {
  DATA_MATRIX_FIXED_DARK,
  DATA_MATRIX_FIXED_LIGHT,
  dataMatrixPlacement,
} from './data-matrix-placement';

function symbolFor(text: string): DataMatrixSymbol {
  const result = encodeDataMatrix(text);
  if (!result.ok) throw new Error(result.message);
  return result.symbol;
}

function scan(symbol: DataMatrixSymbol): string {
  const result = decodeDataMatrixModules(symbol.modules, symbol.size);
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

function size(edge: number): (typeof DATA_MATRIX_SIZES)[number] {
  const found = DATA_MATRIX_SIZES.find((candidate) => candidate.size === edge);
  if (found === undefined) throw new Error(`no ${edge}x${edge} symbol`);
  return found;
}

// Codeword vectors from ISO/IEC 16022 (Annex R) as reproduced by ZXing's
// datamatrix encoder tests (Apache-2.0).
describe('Data Matrix codewords', () => {
  it('uses ASCII encodation with digit pairs and Upper Shift', () => {
    expect(dataMatrixAsciiCodewords('123456')).toEqual([142, 164, 186]);
    expect(dataMatrixAsciiCodewords('123456£')).toEqual([142, 164, 186, 235, 36]);
    expect(dataMatrixAsciiCodewords('30Q324343430794<OQQ')).toEqual([
      160, 82, 162, 173, 173, 173, 137, 224, 61, 80, 82, 82,
    ]);
    expect(dataMatrixAsciiCodewords('日本')).toBeNull();
  });

  it('pads with 129 and then the 253-state randomised pad', () => {
    expect(padDataMatrix([66], 3)).toEqual([66, 129, 70]);
    expect(padDataMatrix([66, 74, 78, 66, 74, 78], 8)).toEqual([66, 74, 78, 66, 74, 78, 129, 56]);
  });

  it('appends the published check codewords', () => {
    expect(Array.from(dataMatrixCodewords([142, 164, 186], size(10)))).toEqual([
      142, 164, 186, 114, 25, 5, 88, 102,
    ]);
    expect(Array.from(dataMatrixCodewords([66, 129, 70], size(10)))).toEqual([
      66, 129, 70, 138, 234, 82, 82, 95,
    ]);
    expect(
      Array.from(dataMatrixCodewords(padDataMatrix([66, 74, 78, 66, 74, 78], 8), size(14))),
    ).toEqual([66, 74, 78, 66, 74, 78, 129, 56, 35, 102, 192, 96, 226, 100, 156, 1, 107, 221]);
  });
});

describe('Data Matrix placement', () => {
  // ZXing PlacementTestCase: "AIMAIM" codewords placed into a 12x12 mapping matrix.
  it('places codewords exactly like the reference placement', () => {
    const codewords = [
      66, 74, 78, 66, 74, 78, 129, 56, 35, 102, 192, 96, 226, 100, 156, 1, 107, 221,
    ];
    const placement = dataMatrixPlacement(12, 12);
    const rows: string[] = [];
    for (let row = 0; row < 12; row += 1) {
      let line = '';
      for (let column = 0; column < 12; column += 1) {
        const entry = placement[row * 12 + column] ?? DATA_MATRIX_FIXED_LIGHT;
        if (entry === DATA_MATRIX_FIXED_DARK) line += '1';
        else if (entry < 0) line += '0';
        else line += String(((codewords[entry >> 3] ?? 0) >> (7 - (entry & 7))) & 1);
      }
      rows.push(line);
    }
    expect(rows).toEqual([
      '011100001111',
      '001010101000',
      '010001010100',
      '001010100010',
      '000111000100',
      '011000010100',
      '000100001101',
      '011000010000',
      '001100001101',
      '100010010111',
      '011101011010',
      '001011001010',
    ]);
  });

  it.each(DATA_MATRIX_SIZES.map((entry) => [entry.size, entry] as const))(
    'assigns every bit of every codeword exactly once in the %i symbol',
    (_size, entry) => {
      const mapping = entry.regionSize * entry.regions;
      const placement = dataMatrixPlacement(mapping, mapping);
      const bits = (entry.dataCodewords + entry.eccCodewords) * 8;
      const seen = new Uint8Array(bits);
      let fixed = 0;
      for (const value of placement) {
        if (value < 0) fixed += 1;
        else seen[value] = (seen[value] ?? 0) + 1;
      }
      expect(Array.from(seen).every((count) => count === 1)).toBe(true);
      expect(bits + fixed).toBe(mapping * mapping);
      expect([0, 4]).toContain(fixed);
    },
  );
});

describe('encodeDataMatrix', () => {
  it('draws the finder L and clock tracks of a 10x10 symbol', () => {
    const symbol = symbolFor('123456');
    expect(symbol.size).toBe(10);
    const row = (y: number): string =>
      Array.from(symbol.modules.slice(y * 10, y * 10 + 10)).join('');
    expect(row(0)).toBe('1010101010');
    expect(row(9)).toBe('1111111111');
    for (let y = 0; y < 10; y += 1) {
      expect(symbol.modules[y * 10]).toBe(1);
      expect(symbol.modules[y * 10 + 9]).toBe(y % 2 === 1 ? 1 : 0);
    }
  });

  it.each([
    '123456',
    'A',
    'AIMAIM',
    'SN 000123',
    'Größe 42 ÀÉÎ',
    'https://example.com/p/123456789',
    '0123456789'.repeat(12),
    'Lot 2026-09-24 serial '.repeat(12),
  ])('scans back %s', (text) => {
    expect(scan(symbolFor(text))).toBe(text);
  });

  it('picks the smallest square symbol and scans across region and block counts', () => {
    // 204 digit pairs fill 52x52 (two blocks); 1558 fill 144x144 (ten blocks).
    const cases: Array<readonly [number, number]> = [
      [3 * 2, 10],
      [5 * 2, 12],
      [62 * 2, 32],
      [204 * 2, 52],
      [280 * 2, 64],
      [368 * 2, 72],
      [816 * 2, 104],
      [1050 * 2, 120],
      [1304 * 2, 132],
      [1558 * 2, 144],
    ];
    for (const [digits, edge] of cases) {
      const text = '7'.repeat(digits);
      const symbol = symbolFor(text);
      expect(symbol.size, `${digits} digits`).toBe(edge);
      expect(scan(symbol)).toBe(text);
    }
  });

  it('refuses text beyond 144x144 or outside Latin-1 with a clear message', () => {
    const tooLong = encodeDataMatrix('7'.repeat(1558 * 2 + 1));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.message).toContain('Too much data for a Data Matrix');
    const wide = encodeDataMatrix('✓');
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.message).toContain('QR Code');
  });
});
