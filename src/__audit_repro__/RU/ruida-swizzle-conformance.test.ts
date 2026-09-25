// Audit track RU — swizzle conformance (coverage check; PASSES on current code).
//
// Correct behaviour: KerfDesk's swizzleByte/unswizzleByte must equal meerk40t's
// swizzle_byte/unswizzle_byte for every byte and every magic key.
// Upstream: meerk40t rdjob.py L434-449 @7e82652f
// https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L434-L449
//   def swizzle_byte(b, magic):
//       b ^= (b >> 7) & 0xFF; b ^= (b << 7) & 0xFF; b ^= (b >> 7) & 0xFF
//       b ^= magic; b = (b + 1) & 0xFF
// The digests below were produced by running meerk40t's own functions (python3,
// rdjob.py imported unmodified) over magic 0..255 x byte 0..255, magic-major.
// EduTech wiki (Ruida, "Swizzling"): 644XG/644XS/320/633X/654XG = 0x88,
// 634XG = 0x11, RDL9635 = 0x38.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { swizzleByte, unswizzleByte } from '../../core/controllers/ruida/swizzle';

const MEERK40T_SWIZZLE_ALL_MAGICS_SHA256 =
  '47e5ec824460eb3ed6f95ee40b6c89b7acddc7c1bd68f572a2621f914c0a5548';
const MEERK40T_UNSWIZZLE_ALL_MAGICS_SHA256 =
  '446464910f2a1737edfec3dee0579373c10ee5bd4639c32ea3e47e7737d77564';
// meerk40t swizzle_byte(b, 0x88) for b = 0..255.
const MEERK40T_LUT_0X88 =
  '89098b0b8d0d8f0f810183038505870799199b1b9d1d9f1f9111931395159717a929ab2bad2daf2fa121a323a525a727b939bb3bbd3dbf3fb131b333b535b737c949cb4bcd4dcf4fc141c343c545c747d959db5bdd5ddf5fd151d353d555d757e969eb6bed6def6fe161e363e565e767f979fb7bfd7dff7ff171f373f575f7778a0a8c0c8e0e901082028404860688089a1a9c1c9e1ea0209212941496169818aa2aac2cae2eb030a222a424a626a828ba3abc3cbe3ec040b232b434b636b838ca4acc4cce4ed050c242c444c646c848da5adc5cde5ee060d252d454d656d858ea6aec6cee6ef070e262e464e666e868fa7afc7cfe7e0080f272f474f676f878';

function table(fn: (value: number, magic: number) => number): Buffer {
  const out = Buffer.alloc(256 * 256);
  for (let magic = 0; magic < 256; magic += 1) {
    for (let b = 0; b < 256; b += 1) out[magic * 256 + b] = fn(b, magic);
  }
  return out;
}

describe('RU: Ruida swizzle matches meerk40t for all 256 magics x 256 bytes', () => {
  it('swizzle table digest equals meerk40t swizzle_byte', () => {
    const digest = createHash('sha256').update(table(swizzleByte)).digest('hex');
    expect(digest).toBe(MEERK40T_SWIZZLE_ALL_MAGICS_SHA256);
  });

  it('unswizzle table digest equals meerk40t unswizzle_byte', () => {
    const digest = createHash('sha256').update(table(unswizzleByte)).digest('hex');
    expect(digest).toBe(MEERK40T_UNSWIZZLE_ALL_MAGICS_SHA256);
  });

  it('the default 0x88 table is byte-identical', () => {
    const lut = Array.from({ length: 256 }, (_, b) => swizzleByte(b).toString(16).padStart(2, '0'));
    expect(lut.join('')).toBe(MEERK40T_LUT_0X88);
  });
});
