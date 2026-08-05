import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import { vcarveEmittedChordCoversProfileSpan } from './vcarve-emitted-chord-coverage';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';
import type { RadialEnvelope } from './radial-envelope';

const coordinate = fc.integer({ min: -1_000, max: 1_000 }).map((value) => value / 100);
const depth = fc.integer({ min: 0, max: 200 }).map((value) => -value / 100);
const point = fc.tuple(coordinate, coordinate, depth).map(([x, y, z]): Vec3 => ({ x, y, z }));
const envelope = fc
  .tuple(
    fc.integer({ min: 1, max: 300 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 1, max: 400 }),
  )
  .map(
    ([tanHundredths, tipHundredths, radialSpanHundredths]): RadialEnvelope => ({
      tanHalf: tanHundredths / 100,
      tipRadiusMm: tipHundredths / 100,
      outerRadiusMm: (tipHundredths + radialSpanHundredths) / 100,
    }),
  );
const tolerance = fc.integer({ min: 0, max: 100 }).map((value) => value / 1_000);

describe('one-chord emitted-profile coverage', () => {
  it('matches the general certificate for offset compaction-sized spans', () => {
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 5, maxLength: 48 }),
        fc.nat(),
        fc.nat(),
        envelope,
        tolerance,
        (reference, startSeed, endSeed, radialEnvelope, toleranceMm) => {
          const start = 1 + (startSeed % (reference.length - 3));
          const maximumEnd = Math.min(reference.length - 1, start + 32);
          const end = start + 2 + (endSeed % (maximumEnd - start - 1));
          const a = reference[start];
          const b = reference[end];
          if (a === undefined || b === undefined) return;
          const expected = vcarveEmittedProfileCovers(
            reference.slice(start, end + 1),
            [a, b],
            radialEnvelope,
            toleranceMm,
          );
          const actual = vcarveEmittedChordCoversProfileSpan(
            reference,
            start,
            end,
            a,
            b,
            radialEnvelope,
            toleranceMm,
          );
          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });
});
