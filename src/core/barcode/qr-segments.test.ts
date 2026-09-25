import { describe, expect, it } from 'vitest';

import { appendQrSegmentBits, qrSegmentBits, qrSegmentsFor, type QrSegment } from './qr-segments';

function payloadBits(segment: QrSegment, version: number, headerBits: number): string {
  const bits: number[] = [];
  appendQrSegmentBits(bits, segment, version);
  expect(bits).toHaveLength(qrSegmentBits(segment, version));
  return bits.slice(headerBits).join('');
}

function modes(text: string, version = 1): string[] {
  return qrSegmentsFor(text, version).map((segment) => segment.mode);
}

describe('QR Code segment bits', () => {
  // Payload vectors from ZXing EncoderTestCase (Apache-2.0).
  it('packs digits in groups of three, then 7 or 4 bits for the tail', () => {
    const numeric = (digits: string): QrSegment => ({
      mode: 'numeric',
      values: Array.from(digits, Number),
    });
    expect(payloadBits(numeric('1'), 1, 14)).toBe('0001');
    expect(payloadBits(numeric('12'), 1, 14)).toBe('0001100');
    expect(payloadBits(numeric('123'), 1, 14)).toBe('0001111011');
    expect(payloadBits(numeric('1234'), 1, 14)).toBe('00011110110100');
  });

  it('packs alphanumeric pairs in 11 bits and a lone character in 6', () => {
    const alpha = (values: number[]): QrSegment => ({ mode: 'alphanumeric', values });
    expect(payloadBits(alpha([10]), 1, 13)).toBe('001010');
    expect(payloadBits(alpha([10, 11]), 1, 13)).toBe('00111001101');
    expect(payloadBits(alpha([10, 11, 12]), 1, 13)).toBe('00111001101001100');
  });

  it('writes the mode indicator and a version-dependent character count', () => {
    const segment: QrSegment = { mode: 'byte', values: [0x61, 0x62, 0x63] };
    const bits: number[] = [];
    appendQrSegmentBits(bits, segment, 1);
    expect(bits.join('')).toBe('0100' + '00000011' + '011000010110001001100011');
    expect(qrSegmentBits(segment, 10)).toBe(4 + 16 + 24);
    expect(qrSegmentBits({ mode: 'numeric', values: [1] }, 27)).toBe(4 + 14 + 4);
    expect(qrSegmentBits({ mode: 'alphanumeric', values: [1] }, 26)).toBe(4 + 11 + 6);
  });
});

describe('QR Code segmentation', () => {
  it('uses one segment for single-mode text', () => {
    expect(modes('0123456789')).toEqual(['numeric']);
    expect(modes('HELLO WORLD')).toEqual(['alphanumeric']);
    expect(modes('hello')).toEqual(['byte']);
    expect(modes('')).toEqual([]);
  });

  it('splits where a mode switch pays for its header', () => {
    expect(modes('123456789012345678901234567890abc')).toEqual(['numeric', 'byte']);
    expect(modes('ABCDEFGHIJ0123456789012345')).toEqual(['alphanumeric', 'numeric']);
  });

  it('keeps a short run inside the surrounding mode when a switch would cost more', () => {
    expect(modes('a1b')).toEqual(['byte']);
    expect(modes('AB1C')).toEqual(['alphanumeric']);
  });

  it('never costs more than encoding everything as bytes', () => {
    const samples = ['https://example.com/A1234567', 'SN-000123 lot 45', 'Größe 42 / 1234567890'];
    for (const text of samples) {
      const segments = qrSegmentsFor(text, 1);
      const bits = segments.reduce((sum, segment) => sum + qrSegmentBits(segment, 1), 0);
      const bytes = new TextEncoder().encode(text).length;
      expect(bits, text).toBeLessThanOrEqual(4 + 8 + bytes * 8);
    }
  });

  it('encodes non-ASCII text as UTF-8 bytes', () => {
    const [segment] = qrSegmentsFor('é', 1);
    expect(segment).toEqual({ mode: 'byte', values: [0xc3, 0xa9] });
  });
});
