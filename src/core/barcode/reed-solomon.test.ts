import { describe, expect, it } from 'vitest';

import {
  DATA_MATRIX_FIELD,
  QR_FIELD,
  reedSolomonGenerator,
  reedSolomonRemainder,
  type GaloisField,
} from './reed-solomon';

function check(field: GaloisField, data: number[], count: number, firstRoot: number): number[] {
  return Array.from(
    reedSolomonRemainder(field, data, reedSolomonGenerator(field, count, firstRoot)),
  );
}

describe('Reed-Solomon check codewords', () => {
  it('builds the published QR generator polynomial for 7 codewords', () => {
    // ISO/IEC 18004 Annex A: x^7 + α^87x^6 + α^229x^5 + α^146x^4 + α^149x^3 + α^238x^2 + α^102x + α^21.
    const generator = reedSolomonGenerator(QR_FIELD, 7, 0);
    expect(Array.from(generator, (coefficient) => QR_FIELD.log[coefficient])).toEqual([
      87, 229, 146, 149, 238, 102, 21,
    ]);
  });

  it('matches the ISO/IEC 18004 Annex I example (01234567 at 1-M)', () => {
    const data = [
      0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11,
    ];
    expect(check(QR_FIELD, data, 10, 0)).toEqual([
      0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55,
    ]);
  });

  it('matches the HELLO WORLD 1-M worked example', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(check(QR_FIELD, data, 10, 0)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  // ZXing EncoderTestCase.testGenerateECBytes and ReedSolomonTestCase (Apache-2.0).
  it('matches independent QR vectors, including a leading zero check codeword', () => {
    expect(check(QR_FIELD, [32, 65, 205, 69, 41, 220, 46, 128, 236], 17, 0)).toEqual([
      42, 159, 74, 221, 244, 169, 239, 150, 138, 70, 237, 85, 224, 96, 74, 219, 61,
    ]);
    expect(
      check(QR_FIELD, [67, 70, 22, 38, 54, 70, 86, 102, 118, 134, 150, 166, 182, 198, 214], 18, 0),
    ).toEqual([175, 80, 155, 64, 178, 45, 214, 233, 65, 209, 12, 155, 117, 31, 140, 214, 27, 187]);
    expect(check(QR_FIELD, [32, 49, 205, 69, 42, 20, 0, 236, 17], 17, 0)).toEqual([
      0, 3, 130, 179, 194, 0, 55, 211, 110, 79, 98, 72, 170, 96, 211, 137, 213,
    ]);
    const long = [
      0x72, 0x67, 0x2f, 0x77, 0x69, 0x6b, 0x69, 0x2f, 0x4d, 0x61, 0x69, 0x6e, 0x5f, 0x50, 0x61,
      0x67, 0x65, 0x3b, 0x3b, 0x00, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
      0xec, 0x11,
    ];
    expect(check(QR_FIELD, long, 18, 0)).toEqual([
      0xd8, 0xb8, 0xef, 0x14, 0xec, 0xd0, 0xcc, 0x85, 0x73, 0x40, 0x0b, 0xb5, 0x5a, 0xb8, 0x8b,
      0x2e, 0x08, 0x62,
    ]);
  });

  it('matches the Data Matrix 123456 example and a longer Data Matrix vector', () => {
    expect(check(DATA_MATRIX_FIELD, [142, 164, 186], 5, 1)).toEqual([114, 25, 5, 88, 102]);
    const data = [
      0x69, 0x75, 0x75, 0x71, 0x3b, 0x30, 0x30, 0x64, 0x70, 0x65, 0x66, 0x2f, 0x68, 0x70, 0x70,
      0x68, 0x6d, 0x66, 0x2f, 0x64, 0x70, 0x6e, 0x30, 0x71, 0x30, 0x7b, 0x79, 0x6a, 0x6f, 0x68,
      0x30, 0x81, 0xf0, 0x88, 0x1f, 0xb5,
    ];
    expect(check(DATA_MATRIX_FIELD, data, 24, 1)).toEqual([
      0x1c, 0x64, 0xee, 0xeb, 0xd0, 0x1d, 0x00, 0x03, 0xf0, 0x1c, 0xf1, 0xd0, 0x6d, 0x00, 0x98,
      0xda, 0x80, 0x88, 0xbe, 0xff, 0xb7, 0xfa, 0xa9, 0x95,
    ]);
  });
});
