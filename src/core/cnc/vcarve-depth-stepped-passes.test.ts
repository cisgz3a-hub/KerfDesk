import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { certifiedVCarveDepthSteppedPasses } from './vcarve-depth-stepped-passes';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';

const TAN_HALF = 1;
const SWEEP_TOLERANCE_MM = 0.01;
const DISTANT_BOUNDARY: ReadonlyArray<BoundarySegment> = [{ ax: -10, ay: -10, bx: 10, by: -10 }];

describe('certifiedVCarveDepthSteppedPasses', () => {
  it('compacts the flattened points of each actual depth level', () => {
    const reference: ReadonlyArray<Vec3> = Array.from({ length: 17 }, (_, index) => ({
      x: index * 0.01,
      y: 0,
      z: -2,
    }));
    const passes = certifiedVCarveDepthSteppedPasses(
      reference,
      reference,
      false,
      DISTANT_BOUNDARY,
      {
        depthPerPassMm: 1,
        tanHalf: TAN_HALF,
        compactionToleranceMm: 0.005,
        sweepToleranceMm: SWEEP_TOLERANCE_MM,
      },
    );

    expect(passes).toHaveLength(2);
    for (const pass of passes) {
      expect(pass.kind).toBe('path3d');
      if (pass.kind !== 'path3d') throw new Error('Expected a V-carve path.');
      expect(pass.points).toHaveLength(2);
      const levelZ = Math.min(...pass.points.map((point) => point.z));
      const referenceLevel = reference.map((point) => ({ ...point, z: Math.max(point.z, levelZ) }));
      expect(
        vcarveEmittedProfileCovers(referenceLevel, pass.points, TAN_HALF, SWEEP_TOLERANCE_MM),
      ).toBe(true);
    }
  });
});
