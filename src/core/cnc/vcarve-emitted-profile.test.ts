import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';

const TOLERANCE_MM = 0.01;
const TAN_HALF = 1;

function point(x: number, y: number, z = -0.1): Vec3 {
  return { x, y, z };
}

describe('emitted V-carve profile coverage', () => {
  it('accepts identical and subdivided emitted cone capsules', () => {
    const reference = [point(0, 0), point(1, 0)];

    expect(vcarveEmittedProfileCovers(reference, reference, TAN_HALF, TOLERANCE_MM)).toBe(true);
    expect(
      vcarveEmittedProfileCovers(
        reference,
        [point(0, 0), point(0.5, 0), point(1, 0)],
        TAN_HALF,
        TOLERANCE_MM,
      ),
    ).toBe(true);
  });

  it('rejects an emitted shortcut whose swept disk loses more than tolerance', () => {
    expect(
      vcarveEmittedProfileCovers(
        [point(0, 0), point(1, 0)],
        [point(0, 0.02), point(1, 0.02)],
        TAN_HALF,
        TOLERANCE_MM,
      ),
    ).toBe(false);
  });
});
