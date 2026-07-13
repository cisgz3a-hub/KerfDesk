import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { planStraightInlayPair } from './inlay-pair';

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
});
