import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { compactVCarveEmittedProfile } from './vcarve-emitted-profile-compaction';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';
import { coneRemovedDepth, type RemovalChord } from './vcarve-removal.test-support';

const TAN_HALF = 1;
const POINT_ENVELOPE = {
  tanHalf: TAN_HALF,
  tipRadiusMm: 0,
  outerRadiusMm: Number.POSITIVE_INFINITY,
} as const;
const TOLERANCE_MM = 0.01;
const DISTANT_BOUNDARY: ReadonlyArray<BoundarySegment> = [{ ax: -10, ay: -10, bx: 10, by: -10 }];

describe('compactVCarveEmittedProfile', () => {
  it('replaces certified collinear microsegments with one emitted chord', () => {
    const points: ReadonlyArray<Vec3> = Array.from({ length: 17 }, (_, index) => ({
      x: index * 0.01,
      y: 0,
      z: -0.05,
    }));

    const compact = compactVCarveEmittedProfile(
      points,
      DISTANT_BOUNDARY,
      POINT_ENVELOPE,
      TOLERANCE_MM,
    );

    expect(compact).toEqual([points[0], points.at(-1)]);
    expect(vcarveEmittedProfileCovers(points, compact, POINT_ENVELOPE, TOLERANCE_MM)).toBe(true);
  });

  it('retains an excursion that one chord cannot cover', () => {
    const points: ReadonlyArray<Vec3> = [
      { x: 0, y: 0, z: -0.05 },
      { x: 0.05, y: 0.1, z: -0.05 },
      { x: 0.1, y: 0, z: -0.05 },
    ];

    const compact = compactVCarveEmittedProfile(
      points,
      DISTANT_BOUNDARY,
      POINT_ENVELOPE,
      TOLERANCE_MM,
    );

    expect(compact).toEqual(points);
  });

  it('retains cutting at a surface corner despite a larger footprint allowance', () => {
    const approach = [
      { x: 0.2, y: 0, z: -0.183 },
      { x: 0.039, y: 0, z: -0.035 },
      { x: 0.02, y: 0, z: -0.017 },
      { x: 0.01, y: 0, z: -0.008 },
      { x: 0.005, y: 0, z: -0.003 },
      { x: 0.002, y: 0, z: -0.001 },
      { x: 0.001, y: 0, z: 0 },
    ];
    const points = [...approach, { x: 0, y: 0, z: 0 }, ...approach.toReversed()];
    const compact = compactVCarveEmittedProfile(points, DISTANT_BOUNDARY, POINT_ENVELOPE, 0.005);
    const chords: RemovalChord[] = compact.flatMap((b, index) => {
      const a = compact[index - 1];
      return a === undefined ? [] : [[a, b]];
    });
    // Dropping the whole shallow turn keeps its swept footprint within
    // 0.005 mm, but leaves this inward corner witness completely uncut.
    expect(coneRemovedDepth({ x: 0.003, y: 0 }, chords, 90)).toBeGreaterThan(0.001);
  });
});
