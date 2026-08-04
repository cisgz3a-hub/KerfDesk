import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';

const TOLERANCE_MM = 0.01;
const TAN_HALF = 1;
const POINT_ENVELOPE = {
  tanHalf: TAN_HALF,
  tipRadiusMm: 0,
  outerRadiusMm: Number.POSITIVE_INFINITY,
} as const;
const FLAT_ENVELOPE = { ...POINT_ENVELOPE, tipRadiusMm: 0.2, outerRadiusMm: 1 } as const;

function point(x: number, y: number, z = -0.1): Vec3 {
  return { x, y, z };
}

describe('emitted V-carve profile coverage', () => {
  it('accepts identical and subdivided emitted cone capsules', () => {
    const reference = [point(0, 0), point(1, 0)];

    expect(vcarveEmittedProfileCovers(reference, reference, POINT_ENVELOPE, TOLERANCE_MM)).toBe(
      true,
    );
    expect(
      vcarveEmittedProfileCovers(
        reference,
        [point(0, 0), point(0.5, 0), point(1, 0)],
        POINT_ENVELOPE,
        TOLERANCE_MM,
      ),
    ).toBe(true);
  });

  it('rejects an emitted shortcut whose swept disk loses more than tolerance', () => {
    expect(
      vcarveEmittedProfileCovers(
        [point(0, 0), point(1, 0)],
        [point(0, 0.02), point(1, 0.02)],
        POINT_ENVELOPE,
        TOLERANCE_MM,
      ),
    ).toBe(false);
  });

  it('certifies a mixed flat-tip descent and rejects a zero-depth substitute', () => {
    const reference = [point(0, 0, 0), point(1, 0, -0.1)];

    expect(vcarveEmittedProfileCovers(reference, reference, FLAT_ENVELOPE, TOLERANCE_MM)).toBe(
      true,
    );
    expect(
      vcarveEmittedProfileCovers(
        reference,
        [point(0, 0, 0), point(1, 0, 0)],
        FLAT_ENVELOPE,
        TOLERANCE_MM,
      ),
    ).toBe(false);
  });
});
