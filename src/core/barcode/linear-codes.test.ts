import { describe, expect, it } from 'vitest';

import { readCode128, readCode39, readEan } from '../../__fixtures__/barcode/linear-decoders';
import { CODE128_WIDTHS, code128Values, encodeCode128 } from './code128';
import { encodeCode39 } from './code39';
import { encodeEanUpc, gs1CheckDigit, type EanKind } from './ean-upc';
import type { LinearEncodeResult, LinearSymbol } from './linear-symbol';

function symbol(result: LinearEncodeResult): LinearSymbol {
  if (!result.ok) throw new Error(result.message);
  return result.symbol;
}

function codes(text: string): number[] {
  return Array.from(text, (char) => char.codePointAt(0) ?? 0);
}

// ZXing writer tests (Apache-2.0) print the symbol inside a margin of light
// modules; every symbology here starts and ends with a bar.
function trimmed(modules: string): string {
  return modules.slice(modules.indexOf('1'), modules.lastIndexOf('1') + 1);
}

describe('Code 128', () => {
  it('has 106 distinct 11-module patterns with even bar sums and a 13-module stop', () => {
    const patterns = CODE128_WIDTHS.slice(0, 106);
    expect(new Set(patterns).size).toBe(106);
    for (const widths of patterns) {
      const elements = Array.from(widths, Number);
      expect(elements.reduce((sum, width) => sum + width, 0)).toBe(11);
      expect(((elements[0] ?? 0) + (elements[2] ?? 0) + (elements[4] ?? 0)) % 2).toBe(0);
    }
    expect(CODE128_WIDTHS[106]).toBe('2331112');
  });

  it('matches the published check-character example (PJJ123C)', () => {
    expect(code128Values(codes('PJJ123C'))).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55]);
  });

  it('packs even digit runs into code set C', () => {
    expect(code128Values(codes('1234'))).toEqual([105, 12, 34, 82]);
    expect(code128Values(codes('12345678'))[0]).toBe(105);
  });

  it('matches independent module strings for set A and B switching', () => {
    const start = '11010000100';
    const expected =
      start +
      '10100001100' + // NUL
      '10100011000' + // A
      '10001011000' + // B
      '10111101110' + // switch to B
      '10010110000' + // a
      '10010000110' + // b
      '11101011110' + // switch to A
      '10100111100' + // DLE
      '11001110100' + // check 22
      '1100011101011';
    const encoded = symbol(encodeCode128('\0ABab\u0010')).modules;
    // Equal-length alternatives exist; the shortest search must at least match
    // the reference length and read back the same data.
    expect(encoded).toHaveLength(expected.length);
    expect(readCode128(encoded)).toBe('\0ABab\u0010');
    expect(readCode128(expected)).toBe('\0ABab\u0010');
  });

  it('uses Shift for a single character from the other set', () => {
    const values = code128Values(codes('ab\0ab'));
    expect(values).toEqual([104, 65, 66, 98, 64, 65, 66, expect.any(Number)]);
  });

  it.each([
    'Hello, World!',
    'SN-000123',
    '0123456789',
    'ABC1234567890DEF',
    'lot 42\tbin 7',
    'X1Y22Z333W4444',
    '1',
    '99',
  ])('reads back %s', (text) => {
    const encoded = symbol(encodeCode128(text));
    expect(readCode128(encoded.modules)).toBe(text);
  });

  it('refuses non-ASCII text and empty data', () => {
    expect(encodeCode128('Größe').ok).toBe(false);
    expect(encodeCode128('').ok).toBe(false);
  });
});

describe('Code 39', () => {
  it('matches the independent 2:1 module string for the full alphabet', () => {
    const expected = trimmed(
      '000001001011011010110101001011010110100101101101101001010101011001011011010110010101' +
        '011011001010101010011011011010100110101011010011010101011001101011010101001101011010' +
        '100110110110101001010101101001101101011010010101101101001010101011001101101010110010' +
        '101101011001010101101100101100101010110100110101011011001101010101001011010110110010' +
        '110101010011011010101010011011010110100101011010110010101101101100101010101001101011' +
        '01101001101010101100110101010100101101101101001011010101100101101010010110110100000',
    );
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    expect(symbol(encodeCode39(text, 2)).modules).toBe(expected);
  });

  it('uses 3:1 wide elements by default and reads back', () => {
    const encoded = symbol(encodeCode39('KERF-42 $/+%.'));
    expect(encoded.modules.startsWith('100010111011101')).toBe(true);
    expect(readCode39(encoded.modules)).toBe('KERF-42 $/+%.');
  });

  it('names the character it cannot encode', () => {
    const result = encodeCode39('abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('"a"');
  });
});

describe('EAN-13, UPC-A and EAN-8', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('590123412345')).toBe(7);
    expect(gs1CheckDigit('400638133393')).toBe(1);
    expect(gs1CheckDigit('12345678901')).toBe(2);
    expect(gs1CheckDigit('9638507')).toBe(4);
  });

  it.each([
    [
      'ean13',
      '5901234123457',
      '00001010001011010011101100110010011011110100111010101011001101101100100001010111001001110100010010100000',
    ],
    [
      'ean13',
      '590123412345',
      '00001010001011010011101100110010011011110100111010101011001101101100100001010111001001110100010010100000',
    ],
    [
      'upca',
      '485963095124',
      '00001010100011011011101100010001011010111101111010101011100101110100100111011001101101100101110010100000',
    ],
    [
      'upca',
      '12345678901',
      '00001010011001001001101111010100011011000101011110101010001001001000111010011100101100110110110010100000',
    ],
    [
      'ean8',
      '96385074',
      '0000001010001011010111101111010110111010101001110111001010001001011100101000000',
    ],
    [
      'ean8',
      '9638507',
      '0000001010001011010111101111010110111010101001110111001010001001011100101000000',
    ],
  ] as const)('%s %s matches the independent module string', (kind, data, reference) => {
    expect(symbol(encodeEanUpc(kind, data)).modules).toBe(trimmed(reference));
  });

  it.each([
    ['ean13', '4006381333931', '4006381333931'],
    ['upca', '036000291452', '0036000291452'],
    ['ean8', '55123457', '55123457'],
  ] as const)('%s %s reads back', (kind: EanKind, data, read) => {
    expect(readEan(symbol(encodeEanUpc(kind, data)).modules)).toBe(read);
  });

  it('refuses a wrong check digit instead of encoding another number', () => {
    const result = encodeEanUpc('ean13', '5901234123458');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('should be 7');
    expect(encodeEanUpc('upca', '12345').ok).toBe(false);
    expect(encodeEanUpc('ean8', '1234567a').ok).toBe(false);
  });

  it('extends guard bars, and UPC-A outer digit bars, beside the text', () => {
    const ean = symbol(encodeEanUpc('ean13', '5901234123457'));
    expect([...ean.extendedBars].sort((a, b) => a - b)).toEqual([0, 2, 46, 48, 92, 94]);
    const upc = symbol(encodeEanUpc('upca', '036000291452'));
    expect(upc.extendedBars.size).toBeGreaterThan(6);
    expect(upc.text.map((run) => run.text)).toEqual(['0', '36000', '29145', '2']);
  });
});
