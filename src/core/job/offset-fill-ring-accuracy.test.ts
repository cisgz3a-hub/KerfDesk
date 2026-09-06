// Preserve the original analytic witness while source-ring performance remains
// under review: docs/proposals/2026-09-06-offset-fill-source-rings.md.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { offsetFillContours, type OffsetFillResult } from './offset-fill';

const SOURCE_RADIUS_MM = 30;
const SPACING_MM = 0.1;
const SOURCE_POINTS = 2000;
// Smaller rings have too few vertices for area-derived radius to be meaningful.
const MIN_MEANINGFUL_RADIUS_MM = 2;
// Retain the original tolerance, allowing for the 1 µm Clipper grid and faceting.
const RADIUS_TOLERANCE_MM = 0.004;
// The full source-ring witness measured 26–33 s locally. Give the same fixture
// an explicit CI-sized allowance without accessing platform state in core tests.
// Do not weaken its geometry or numerical thresholds to reduce this cost.
const FIXTURE_TIMEOUT_MS = 180_000;

function circle(pointCount: number, radiusMm: number): Polyline {
  const points: Vec2[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    const theta = (i / pointCount) * Math.PI * 2;
    points.push({ x: radiusMm * Math.cos(theta), y: radiusMm * Math.sin(theta) });
  }
  return { closed: true, points: [...points, points[0] as Vec2] };
}

// Area-equivalent radius is independent of the offset's first vertex. This is
// a circular-fixture oracle, not a bound on arbitrary geometry or emitted moves.
function equivalentRadiusMm(polyline: Polyline): number {
  let twiceArea = 0;
  for (let i = 0; i < polyline.points.length - 1; i += 1) {
    const a = polyline.points[i] as Vec2;
    const b = polyline.points[i + 1] as Vec2;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.sqrt(Math.abs(twiceArea / 2) / Math.PI);
}

describe('offsetFillContours ring accuracy', () => {
  let result: OffsetFillResult;

  beforeAll(() => {
    result = offsetFillContours({
      polylines: [circle(SOURCE_POINTS, SOURCE_RADIUS_MM)],
      spacingMm: SPACING_MM,
    });
  }, FIXTURE_TIMEOUT_MS);

  it('produces the expected ring count for the source', () => {
    expect(result.contours.length).toBeGreaterThan(250);
    expect(result.termination).toEqual({ kind: 'complete' });
  });

  it('every meaningful ring lands within the original nominal-radius tolerance', () => {
    let worstErrorMm = 0;
    let worstIndex = -1;
    result.contours.forEach((ring, index) => {
      const nominal = SOURCE_RADIUS_MM - (SPACING_MM / 2 + index * SPACING_MM);
      if (nominal < MIN_MEANINGFUL_RADIUS_MM) return;
      const error = Math.abs(equivalentRadiusMm(ring) - nominal);
      if (error > worstErrorMm) {
        worstErrorMm = error;
        worstIndex = index;
      }
    });
    expect(
      worstErrorMm,
      `worst ring radius error ${(worstErrorMm * 1000).toFixed(1)}µm at ring ${worstIndex}`,
    ).toBeLessThan(RADIUS_TOLERANCE_MM);
  });

  it('keeps consecutive rings one spacing apart', () => {
    const rings = result.contours;
    for (let index = 1; index < rings.length; index += 1) {
      const outer = rings[index - 1];
      const inner = rings[index];
      if (outer === undefined || inner === undefined) continue;
      const innerRadius = equivalentRadiusMm(inner);
      if (innerRadius < MIN_MEANINGFUL_RADIUS_MM) continue;
      const gap = equivalentRadiusMm(outer) - innerRadius;
      expect(Math.abs(gap - SPACING_MM)).toBeLessThan(RADIUS_TOLERANCE_MM);
    }
  });
});
