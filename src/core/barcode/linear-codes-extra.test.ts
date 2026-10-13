import { describe, expect, it } from 'vitest';
import { encodeBarcodeSymbol } from './barcode-symbol';
import { encodeCodabar, encodeItf } from './codabar-itf';
import { encodeCode93 } from './code93';
import { encodeUpcE, expandUpcE, isbnToEan13 } from './upce-isbn';

function modules(result: ReturnType<typeof encodeCode93>): string {
  if (!result.ok) throw new Error(result.message);
  return result.symbol.modules;
}

describe('Code 93', () => {
  it('appends the C and K check characters of the reference example TEST93 (+ and 6)', () => {
    const plus = '101110110';
    const six = '100100010';
    const encoded = modules(encodeCode93('TEST93'));
    // start, six data characters, C, K, stop, termination bar
    expect(encoded).toHaveLength(9 * 10 + 1);
    expect(encoded.slice(9 * 7, 9 * 8)).toBe(plus);
    expect(encoded.slice(9 * 8, 9 * 9)).toBe(six);
    expect(encoded.endsWith('1010111101')).toBe(true);
  });

  it('writes lower case as a Full ASCII shift pair and refuses non-ASCII', () => {
    // "a" is (+)A: two characters plus two checks.
    expect(modules(encodeCode93('a'))).toHaveLength(9 * 6 + 1);
    expect(encodeCode93('é').ok).toBe(false);
  });
});

describe('Codabar', () => {
  it('frames bare data as A ... B and keeps given start and stop characters', () => {
    const bare = modules(encodeCodabar('40156'));
    expect(bare).toBe(modules(encodeCodabar('A40156B')));
    expect(modules(encodeCodabar('C1D')).startsWith('1010001000111')).toBe(true);
    expect(encodeCodabar('12A3').ok).toBe(false);
  });
});

describe('Interleaved 2 of 5', () => {
  it('pairs digits bars-and-spaces, pads an odd count and frames start and stop', () => {
    const encoded = modules(encodeItf('12'));
    // start 1010; pair "12": bars of 1 = WNNNW, spaces of 2 = NWNNW (wide = 3).
    expect(encoded).toBe(
      '1010' + '111' + '0' + '1' + '000' + '1' + '0' + '1' + '0' + '111' + '000' + '11101',
    );
    const odd = encodeItf('123');
    expect(odd.ok && odd.symbol.text[0]?.text).toBe('0123');
    expect(encodeItf('12a').ok).toBe(false);
  });
});

describe('UPC-E and ISBN', () => {
  it('expands to the UPC-A number and encodes the check digit in the parity', () => {
    expect(expandUpcE('0', '425261')).toBe('04210000526');
    const encoded = encodeUpcE('04252614');
    expect(encoded.ok && encoded.symbol.modules).toHaveLength(51);
    expect(encodeUpcE('425261')).toEqual(encoded);
    expect(encodeUpcE('04252615').ok).toBe(false);
    expect(encodeUpcE('2425261').ok).toBe(false);
  });

  it('turns an ISBN-10 into its 978 EAN-13 and checks the ISBN-10 check character', () => {
    expect(isbnToEan13('0-306-40615-2')).toEqual({ ok: true, ean: '9780306406157' });
    expect(isbnToEan13('978-3-16-148410-0')).toEqual({ ok: true, ean: '9783161484100' });
    expect(isbnToEan13('0-306-40615-3').ok).toBe(false);
    const symbol = encodeBarcodeSymbol('isbn', '0306406152', 'M');
    expect(symbol.ok && symbol.symbol.description).toContain('9780306406157');
  });
});
