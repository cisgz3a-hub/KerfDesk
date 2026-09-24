import { describe, expect, it } from 'vitest';

import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import {
  REFERENCE_QR_SYMBOLS,
  referenceModules,
} from '../../__fixtures__/barcode/qr-reference-symbols';
import {
  encodeQr,
  interleaveQrBlocks,
  qrCodewords,
  qrDataCodewords,
  type QrSymbol,
} from './qr-encode';
import { qrPenalty } from './qr-mask';
import { qrSegmentsFor } from './qr-segments';
import type { QrErrorCorrection } from './qr-tables';

function encoded(text: string, errorCorrection: QrErrorCorrection, mask?: number): QrSymbol {
  const result = encodeQr(
    text,
    mask === undefined ? { errorCorrection } : { errorCorrection, mask },
  );
  if (!result.ok) throw new Error(result.message);
  return result.symbol;
}

function scan(symbol: QrSymbol): string {
  const result = decodeQrModules(symbol.modules, symbol.size);
  if (!result.ok) throw new Error(result.reason);
  expect(result.version).toBe(symbol.version);
  expect(result.level).toBe(symbol.errorCorrection);
  expect(result.mask).toBe(symbol.mask);
  return result.text;
}

describe('encodeQr codewords', () => {
  it('builds the HELLO WORLD 1-M data and check codewords', () => {
    const segments = qrSegmentsFor('HELLO WORLD', 1);
    expect(Array.from(qrDataCodewords(segments, 1, 'M'))).toEqual([
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ]);
    expect(Array.from(qrCodewords(segments, 1, 'M')).slice(16)).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it('builds the ISO/IEC 18004 Annex I data codewords for 01234567 at 1-M', () => {
    const data = qrDataCodewords(qrSegmentsFor('01234567', 1), 1, 'M');
    expect(Array.from(data)).toEqual([
      0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11,
    ]);
  });

  // Interleaving vector (version 5-Q, two short and two long blocks) from ZXing
  // EncoderTestCase.testInterleaveWithECBytes (Apache-2.0).
  it('interleaves short blocks before long blocks', () => {
    const data = Uint8Array.from([
      67, 70, 22, 38, 54, 70, 86, 102, 118, 134, 150, 166, 182, 198, 214, 230, 247, 7, 23, 39, 55,
      71, 87, 103, 119, 135, 151, 166, 22, 38, 54, 70, 86, 102, 118, 134, 150, 166, 182, 198, 214,
      230, 247, 7, 23, 39, 55, 71, 87, 103, 119, 135, 151, 160, 236, 17, 236, 17, 236, 17, 236, 17,
    ]);
    expect(Array.from(interleaveQrBlocks(data, 5, 'Q'))).toEqual([
      67, 230, 54, 55, 70, 247, 70, 71, 22, 7, 86, 87, 38, 23, 102, 103, 54, 39, 118, 119, 70, 55,
      134, 135, 86, 71, 150, 151, 102, 87, 166, 160, 118, 103, 182, 236, 134, 119, 198, 17, 150,
      135, 214, 236, 166, 151, 230, 17, 182, 166, 247, 236, 198, 22, 7, 17, 214, 38, 23, 236, 39,
      17, 175, 155, 245, 236, 80, 146, 56, 74, 155, 165, 133, 142, 64, 183, 132, 13, 178, 54, 132,
      108, 45, 113, 53, 50, 214, 98, 193, 152, 233, 147, 50, 71, 65, 190, 82, 51, 209, 199, 171, 54,
      12, 112, 57, 113, 155, 117, 211, 164, 117, 30, 158, 225, 31, 190, 242, 38, 140, 61, 179, 154,
      214, 138, 147, 87, 27, 96, 77, 47, 187, 49, 156, 214,
    ]);
  });
});

describe('encodeQr symbols', () => {
  it.each(REFERENCE_QR_SYMBOLS.map((symbol) => [symbol.text, symbol] as const))(
    'reproduces the reference symbol for %s, including its mask choice',
    (_text, reference) => {
      const symbol = encoded(reference.text, reference.errorCorrection);
      expect(symbol.version).toBe(reference.version);
      expect(symbol.mask).toBe(reference.mask);
      expect(Array.from(symbol.modules)).toEqual(Array.from(referenceModules(reference.rows)));
    },
  );

  it('chooses the mask with the lowest penalty', () => {
    const chosen = encoded('https://kerfdesk.example/p/000123', 'Q');
    for (let mask = 0; mask < 8; mask += 1) {
      const forced = encoded('https://kerfdesk.example/p/000123', 'Q', mask);
      expect(qrPenalty(chosen.modules, chosen.size)).toBeLessThanOrEqual(
        qrPenalty(forced.modules, forced.size),
      );
    }
  });

  it('scans back under every forced mask', () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const symbol = encoded('KerfDesk 2026', 'Q', mask);
      expect(symbol.mask).toBe(mask);
      expect(scan(symbol)).toBe('KerfDesk 2026');
    }
  });

  it.each([
    ['L', 'SERIAL-000001'],
    ['M', 'https://example.com/products/laser?id=12345&lot=A7'],
    ['Q', 'Grüße aus der Werkstatt ✓ 日本語'],
    ['H', '12345678901234567890123456789012345678901234567890'],
    ['M', 'WIFI:T:WPA;S:Workshop;P:correct horse battery staple;;'],
    ['L', 'BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane\nTEL:+1-555-0100\nEND:VCARD'],
  ] as const)('round-trips %s: %s', (level, text) => {
    expect(scan(encoded(text, level))).toBe(text);
  });

  it('round-trips symbols that carry version information (7 and above)', () => {
    const text = 'Lot 2026-09-24 / '.repeat(12) + '0123456789'.repeat(20);
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const symbol = encoded(text, level);
      expect(symbol.version).toBeGreaterThanOrEqual(7);
      expect(scan(symbol)).toBe(text);
    }
  });
});

describe('encodeQr capacity', () => {
  it('uses the smallest version that holds the data', () => {
    expect(encoded('1'.repeat(17), 'H').version).toBe(1);
    expect(encoded('1'.repeat(18), 'H').version).toBe(2);
    expect(encoded('A'.repeat(25), 'L').version).toBe(1);
    expect(encoded('A'.repeat(26), 'L').version).toBe(2);
    expect(encoded('a'.repeat(17), 'L').version).toBe(1);
    expect(encoded('a'.repeat(18), 'L').version).toBe(2);
  });

  it('fills version 40-L to its published capacity and scans it', () => {
    const digits = '0123456789'.repeat(709).slice(0, 7089);
    const numeric = encoded(digits, 'L');
    expect(numeric.version).toBe(40);
    expect(scan(numeric)).toBe(digits);
    expect(encoded('A'.repeat(4296), 'L').version).toBe(40);
    expect(scan(encoded('z'.repeat(2953), 'L'))).toBe('z'.repeat(2953));
  });

  it('refuses data beyond the capacity of version 40 with a clear message', () => {
    for (const [text, level] of [
      ['9'.repeat(7090), 'L'],
      ['A'.repeat(4297), 'L'],
      ['z'.repeat(2954), 'L'],
      ['z'.repeat(1274), 'H'],
    ] as const) {
      const result = encodeQr(text, { errorCorrection: level });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain(`error correction ${level}`);
    }
    expect(encodeQr('z'.repeat(1273), { errorCorrection: 'H' }).ok).toBe(true);
  });
});
