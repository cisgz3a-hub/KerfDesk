// Output-identity proof for the thinning mechanics cut (ADR-438 amendment,
// speed wave 2): the skeleton must be byte-identical to the frozen thinning
// and queue of 952fb13e3 on fuzzed masks, on stroke ribbons of every width,
// on distance fields large enough to take the sparse rank path, and on
// arbitrary integer and non-integer keys. The oracle corpus masks are checked
// by src/__fixtures__/perceptual/trace-parity-thinning.test.ts.

import { describe, expect, it } from 'vitest';
import { fuzzMask, fuzzMasks, seededRandom } from '../mask-fuzz.test-support';
import { squaredDistanceField, type InkMask } from './distance-field';
import { thinToMedialAxis } from './medial-thinning';
import { referenceThinToMedialAxis } from './medial-thinning-reference.test-support';

function expectIdentical(mask: InkMask, distSq = squaredDistanceField(mask)): void {
  const actual = thinToMedialAxis(mask, distSq);
  const expected = referenceThinToMedialAxis(mask, distSq);
  const at = expected.findIndex((value, i) => value !== actual[i]);
  expect(actual.length).toBe(expected.length);
  expect(at, `${mask.width}x${mask.height} differs at ${at}`).toBe(-1);
}

// Straight and diagonal ribbons of width 1..6 (even widths leave the 2-px
// ridge plateau that the neighbour tie exists for), crossing and ending
// inside the grid.
function ribbonMask(seed: number): InkMask {
  const random = seededRandom(seed);
  const width = 8 + Math.floor(random() * 40);
  const height = 8 + Math.floor(random() * 40);
  const ink = new Uint8Array(width * height);
  for (let stroke = 1 + Math.floor(random() * 3); stroke > 0; stroke -= 1) {
    const thickness = 1 + Math.floor(random() * 6);
    const x0 = random() * width;
    const y0 = random() * height;
    const angle = Math.floor(random() * 8) * (Math.PI / 4) + (random() < 0.3 ? random() : 0);
    const length = 4 + random() * Math.max(width, height);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const along = (x + 0.5 - x0) * ux + (y + 0.5 - y0) * uy;
        const across = (x + 0.5 - x0) * -uy + (y + 0.5 - y0) * ux;
        if (along >= 0 && along <= length && Math.abs(across) < thickness / 2) {
          ink[y * width + x] = 1;
        }
      }
    }
  }
  return { width, height, ink };
}

describe('thinToMedialAxis equals the frozen reference byte for byte', () => {
  it('on 4000 fuzzed masks of every family', () => {
    for (const mask of fuzzMasks(4000, 23)) expectIdentical(mask);
  });

  it('on 1000 stroke ribbons of width 1 to 6', () => {
    for (let seed = 0; seed < 1000; seed += 1) expectIdentical(ribbonMask(seed));
  });

  it('on large blob, border and all-ink grids', () => {
    for (const family of ['all-ink', 'blobs', 'border', 'lines', 'dense'] as const) {
      for (let seed = 0; seed < 3; seed += 1) expectIdentical(fuzzMask(seed, family, 160));
    }
  });

  it('on fields scaled past the dense rank table (sparse rank path)', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const mask = fuzzMask(seed, seed % 2 === 0 ? 'blobs' : 'noise', 40);
      const scaled = squaredDistanceField(mask).map((d) => d * 2 ** 22);
      expectIdentical(mask, scaled);
    }
  });

  it('on arbitrary small integer keys and on non-integer keys (heap path)', () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const mask = fuzzMask(seed, seed % 2 === 0 ? 'dense' : 'blobs', 30);
      const random = seededRandom(seed + 7);
      expectIdentical(
        mask,
        Float64Array.from(mask.ink, (v) => v * Math.floor(random() * 5)),
      );
      expectIdentical(
        mask,
        Float64Array.from(mask.ink, (v) => v * random() * 5),
      );
    }
  });
});
