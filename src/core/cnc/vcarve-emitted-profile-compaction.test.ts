import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { compactVCarveEmittedProfile } from './vcarve-emitted-profile-compaction';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';

const TAN_HALF = 1;
const TOLERANCE_MM = 0.01;
const DISTANT_BOUNDARY: ReadonlyArray<BoundarySegment> = [{ ax: -10, ay: -10, bx: 10, by: -10 }];

describe('compactVCarveEmittedProfile', () => {
  it('replaces certified collinear microsegments with one emitted chord', () => {
    const points: ReadonlyArray<Vec3> = Array.from({ length: 17 }, (_, index) => ({
      x: index * 0.01,
      y: 0,
      z: -0.05,
    }));

    const compact = compactVCarveEmittedProfile(points, DISTANT_BOUNDARY, TAN_HALF, TOLERANCE_MM);

    expect(compact).toEqual([points[0], points.at(-1)]);
    expect(vcarveEmittedProfileCovers(points, compact, TAN_HALF, TOLERANCE_MM)).toBe(true);
  });

  it('retains an excursion that one chord cannot cover', () => {
    const points: ReadonlyArray<Vec3> = [
      { x: 0, y: 0, z: -0.05 },
      { x: 0.05, y: 0.1, z: -0.05 },
      { x: 0.1, y: 0, z: -0.05 },
    ];

    const compact = compactVCarveEmittedProfile(points, DISTANT_BOUNDARY, TAN_HALF, TOLERANCE_MM);

    expect(compact).toEqual(points);
  });
});
