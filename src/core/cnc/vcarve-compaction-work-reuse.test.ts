import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../geometry/vec3';
import { buildVCarveBoundarySegmentIndex } from './vcarve-boundary-segment-index';
import { referenceEmittedChordIsSafe } from './vcarve-chord-safety-reference.test-support';
import { referenceCompactVCarveEmittedProfile } from './vcarve-compaction-reference.test-support';
import * as constraints from './vcarve-cutting-constraints';
import { emittedChordIsSafe } from './vcarve-detail-chord-safety';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { compactVCarveEmittedProfile } from './vcarve-emitted-profile-compaction';

const ENVELOPE = {
  tanHalf: 1,
  tipRadiusMm: 0,
  outerRadiusMm: Number.POSITIVE_INFINITY,
  requireInsideBoundary: true,
} as const;
const RECTANGLE: ReadonlyArray<BoundarySegment> = [
  { ax: -1, ay: -1, bx: 8, by: -1 },
  { ax: 8, ay: -1, bx: 8, by: 2 },
  { ax: 8, ay: 2, bx: -1, by: 2 },
  { ax: -1, ay: 2, bx: -1, by: -1 },
];

afterEach(() => vi.restoreAllMocks());

describe('V-carve compaction work reuse', () => {
  it('checks cutting-point membership once while preserving every retained point', () => {
    const points = zigzagPoints();
    const boundary = buildVCarveBoundarySegmentIndex(RECTANGLE);
    const membership = vi.spyOn(constraints, 'pointInsideVCarveBoundary');
    const reference = referenceCompactVCarveEmittedProfile(points, boundary, ENVELOPE, 0.005);
    const referenceQueries = membership.mock.calls.length;
    membership.mockClear();

    expect(compactVCarveEmittedProfile(points, boundary, ENVELOPE, 0.005)).toEqual(reference);
    expect(membership).toHaveBeenCalledTimes(points.filter((point) => point.z < 0).length);
    expect(membership.mock.calls.length).toBeLessThan(referenceQueries / 10);
  });

  it('rechecks membership on each call after geometry or boundary changes', () => {
    const points = [
      { x: 1, y: 0, z: -0.1 },
      { x: 2, y: 0, z: -0.1 },
      { x: 3, y: 0, z: -0.1 },
    ];
    expect(compactVCarveEmittedProfile(points, RECTANGLE, ENVELOPE, 0.005)).toHaveLength(2);
    const first = points[0];
    if (first === undefined) throw new Error('Expected a first endpoint');
    first.x = -3;
    expect(compactVCarveEmittedProfile(points, RECTANGLE, ENVELOPE, 0.005)).toEqual(points);
    first.x = 1;
    const shiftedBoundary = RECTANGLE.map((segment) => ({
      ...segment,
      ay: segment.ay + 10,
      by: segment.by + 10,
    }));
    expect(compactVCarveEmittedProfile(points, shiftedBoundary, ENVELOPE, 0.005)).toEqual(points);
  });

  it('retains the original oracle across surface transitions, flat tips and clearance reserves', () => {
    const points = zigzagPoints();
    for (const tipRadiusMm of [0, 0.05, 0.25]) {
      for (const boundaryClearanceMm of [0, 0.001]) {
        for (const requireInsideBoundary of [false, true]) {
          const envelope = { ...ENVELOPE, tipRadiusMm, boundaryClearanceMm, requireInsideBoundary };
          expect(compactVCarveEmittedProfile(points, RECTANGLE, envelope, 0.005)).toEqual(
            referenceCompactVCarveEmittedProfile(points, RECTANGLE, envelope, 0.005),
          );
        }
      }
    }
  });

  it('keeps the original analytic certificate for both projection directions and numeric scales', () => {
    const random = randomSequence();
    for (const scale of [0.001, 1, 1_000_000]) {
      for (let index = 0; index < 400; index += 1) {
        const coordinate = () => (random() * 2 - 1) * scale;
        const a = { x: coordinate(), y: coordinate() };
        const b = { x: coordinate(), y: coordinate() };
        const ax = coordinate();
        const ay = coordinate();
        const segment = {
          ax,
          ay,
          bx: index % 7 === 0 ? ax : coordinate(),
          by: index % 7 === 0 ? ay : coordinate(),
        };
        const depthA = random() * scale;
        const depthB = random() * scale;
        const envelope = { ...ENVELOPE, requireInsideBoundary: false };
        expect(emittedChordIsSafe(a, b, depthA, depthB, [segment], envelope)).toBe(
          referenceEmittedChordIsSafe(a, b, depthA, depthB, [segment], envelope),
        );
      }
    }
  });
});

function zigzagPoints(): Vec3[] {
  return Array.from({ length: 128 }, (_, index) => ({
    x: index * 0.05,
    y: index % 2 === 0 ? 0 : 0.08,
    z: index % 23 === 0 ? 0 : -0.01,
  }));
}

function randomSequence(): () => number {
  let seed = 0x17ab02ce;
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}
