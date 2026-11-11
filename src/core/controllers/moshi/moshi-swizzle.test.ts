// Moshi swizzle conformance with MeerK40t (ADR-705). The rows below are
// MeerK40t's swizzle_table (meerk40t/moshi/builder.py L9-298 at d511944e, MIT),
// transcribed as hex: row r, column c is a byte Moshi's software sends for
// command r. KerfDesk computes the table from `convert`'s bit permutation, so
// this pins both the permutation and every entry.
import { describe, expect, it } from 'vitest';
import { moshiCommandByte, moshiCommandOf, moshiConvert, moshiReconvert } from './moshi-swizzle';

const MEERK40T_SWIZZLE_TABLE = [
  '00014003102150230409440b1429542b',
  '08114813183158330c194c1b1c395c3b',
  '8005c0079025d027840dc40f942dd42f',
  '8815c8179835d8378c1dcc1f9c3ddc3f',
  '02414243126152630649464b1669566b',
  '0a514a531a715a730e594e5b1e795e7b',
  '8245c2479265d267864dc64f966dd66f',
  '8a55ca579a75da778e5dce5f9e7dde7f',
  '2081608330a170a32489648b34a974ab',
  '2891689338b178b32c996c9b3cb97cbb',
  'a085e087b0a5f0a7a48de48fb4adf4af',
  'a895e897b8b5f8b7ac9dec9fbcbdfcbf',
  '22c162c332e172e326c966cb36e976eb',
  '2ad16ad33af17af32ed96edb3ef97efb',
  'a2c5e2c7b2e5f2e7a6cde6cfb6edf6ef',
  'aad5ead7baf5faf7aeddeedfbefdfeff',
];

describe('Moshi swizzle', () => {
  it('reproduces every entry of MeerK40t swizzle_table', () => {
    for (let command = 0; command < 16; command += 1) {
      const row = MEERK40T_SWIZZLE_TABLE[command] ?? '';
      for (let variant = 0; variant < 16; variant += 1) {
        const expected = Number.parseInt(row.slice(variant * 2, variant * 2 + 2), 16);
        expect(moshiCommandByte(command, variant)).toBe(expected);
        expect(moshiCommandOf(expected)).toBe(command);
      }
    }
  });

  it('convert is a bijection and reconvert is its inverse', () => {
    const seen = new Set<number>();
    for (let byte = 0; byte < 256; byte += 1) {
      seen.add(moshiConvert(byte));
      expect(moshiConvert(moshiReconvert(byte))).toBe(byte);
      expect(moshiReconvert(moshiConvert(byte))).toBe(byte);
    }
    expect(seen.size).toBe(256);
  });
});
