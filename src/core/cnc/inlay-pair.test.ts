import { describe, expect, it } from 'vitest';
import { offsetClosedPolylinesWithRoundJoins } from '../geometry/kerf-offset';
import { pointInPolygon } from '../geometry/point-in-polygon';
import type { Polyline, Vec2 } from '../scene';
import { planStraightInlayPair } from './inlay-pair';
import { pocketToolpathRings } from './pocket-paths';

function square(size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 10, y: 10 },
      { x: 10 + size, y: 10 },
      { x: 10 + size, y: 10 + size },
      { x: 10, y: 10 + size },
    ],
  };
}

function xBounds(polylines: ReadonlyArray<Polyline>): readonly [number, number] {
  const xs = polylines.flatMap((polyline) => polyline.points.map((point) => point.x));
  return [Math.min(...xs), Math.max(...xs)];
}

// 40 x 40 L with one 90 degree inside corner at (30, 30).
const L_SHAPE: Polyline = {
  closed: true,
  points: [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 30 },
    { x: 30, y: 30 },
    { x: 30, y: 50 },
    { x: 10, y: 50 },
  ],
};

function inside(point: Vec2, contours: ReadonlyArray<Polyline>): boolean {
  let count = 0;
  for (const contour of contours) if (pointInPolygon(point, contour.points)) count += 1;
  return count % 2 === 1;
}

// Plug material the insert's outside profile leaves that the pocket does not
// clear, measured on the cut shapes rather than the planned contours: the
// pocket can only clear what a disc of the bit radius reaches inside the
// pocket contour, and the profile leaves everything a disc outside the insert
// contour cannot reach. The insert is flipped back over the pocket to compare.
function plugSamplesOutsidePocket(shape: Polyline, toolDiameterMm: number): number {
  const plan = planStraightInlayPair([shape], {
    toolDiameterMm,
    allowanceMm: 0.1,
    pairSpacingMm: 10,
    stepoverPercent: 40,
  });
  expect(plan.ok).toBe(true);
  if (!plan.ok) return Number.NaN;
  const radius = toolDiameterMm / 2;
  const cutPocket = offsetClosedPolylinesWithRoundJoins(
    offsetClosedPolylinesWithRoundJoins(plan.femaleContours, -radius),
    radius,
  );
  const cutPlug = offsetClosedPolylinesWithRoundJoins(
    offsetClosedPolylinesWithRoundJoins(plan.maleContours, radius),
    -radius,
  );
  const [femaleMinX, femaleMaxX] = xBounds(plan.femaleContours);
  const [maleMinX, maleMaxX] = xBounds(plan.maleContours);
  const flipX = (femaleMinX + femaleMaxX + maleMinX + maleMaxX) / 2;
  let outside = 0;
  let plugSamples = 0;
  for (let x = femaleMinX; x <= femaleMaxX; x += 0.1) {
    for (let y = 5; y <= 55; y += 0.1) {
      if (!inside({ x: flipX - x, y }, cutPlug)) continue;
      plugSamples += 1;
      if (!inside({ x, y }, cutPocket)) outside += 1;
    }
  }
  expect(plugSamples).toBeGreaterThan(0);
  return outside;
}

describe('planStraightInlayPair', () => {
  it('creates a linked pocket and mirrored insert with exact pair spacing', () => {
    const plan = planStraightInlayPair([square(30)], {
      toolDiameterMm: 3.175,
      allowanceMm: 0.1,
      pairSpacingMm: 12,
      stepoverPercent: 40,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.femalePocketPassLimited).toBe(false);
    expect(plan.femaleToolpaths).toEqual(pocketToolpathRings(plan.femaleContours, 3.175, 40));
    expect(plan.femaleToolpaths.length).toBeGreaterThan(0);
    expect(plan.maleToolpaths.length).toBeGreaterThan(0);
    const female = xBounds(plan.femaleContours);
    const male = xBounds(plan.maleContours);
    expect(male[0] - female[1]).toBeCloseTo(12, 6);
    expect(female[1] - female[0] - (male[1] - male[0])).toBeCloseTo(0.2, 6);
    expect(plan.femaleContours[0]!.points.length).toBeGreaterThan(4);
  });

  it('is deterministic and refuses open or too-small geometry', () => {
    const options = {
      toolDiameterMm: 3.175,
      allowanceMm: 0.1,
      pairSpacingMm: 10,
      stepoverPercent: 40,
    };
    const a = planStraightInlayPair([square(20)], options);
    expect(planStraightInlayPair([square(20)], options)).toEqual(a);
    expect(planStraightInlayPair([{ ...square(20), closed: false }], options)).toMatchObject({
      ok: false,
    });
    expect(planStraightInlayPair([square(2)], options)).toMatchObject({ ok: false });
  });

  it.each([3.175, 6.35])('cuts a plug that seats at inside corners (%s mm bit)', (diameter) => {
    expect(plugSamplesOutsidePocket(square(30), diameter)).toBe(0);
    expect(plugSamplesOutsidePocket(L_SHAPE, diameter)).toBe(0);
  });

  it('can place the mirrored insert toward negative machine X', () => {
    const plan = planStraightInlayPair([square(30)], {
      toolDiameterMm: 3.175,
      allowanceMm: 0.1,
      pairSpacingMm: 12,
      stepoverPercent: 40,
      pairDirectionX: -1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const female = xBounds(plan.femaleContours);
    const male = xBounds(plan.maleContours);
    expect(female[0] - male[1]).toBeCloseTo(12, 6);
  });
});
