import { describe, expect, it } from 'vitest';
import { computeProfileLead, type ProfileLeadOptions } from './profile-lead';
import type { Polyline, Vec2 } from '../scene';

// A 10 mm square wound counter-clockwise (Y up, positive shoelace area), start
// vertex at the origin, first edge heading +x.
const CCW_SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

// The same square wound clockwise; start vertex at the origin, first edge +y.
const CW_SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ],
};

const ARC: ProfileLeadOptions = { shape: 'arc', radiusMm: 5 };

function ok(result: ReturnType<typeof computeProfileLead>) {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.reason}`);
  return result.lead;
}

function last(points: ReadonlyArray<Vec2>): Vec2 {
  const point = points[points.length - 1];
  if (point === undefined) throw new Error('empty point list');
  return point;
}

function tangentAtEntry(points: ReadonlyArray<Vec2>): Vec2 {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  if (a === undefined || b === undefined) throw new Error('need two points for a tangent');
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

describe('computeProfileLead — arc leads', () => {
  it('plunges below the bottom edge (exterior) for an outside CCW profile', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'outside', ARC));
    expect(lead.plunge.y).toBeLessThan(0); // exterior of the loop is below the +x bottom edge
    expect(lead.plunge.x).toBeCloseTo(-5, 6);
    expect(lead.plunge.y).toBeCloseTo(-5, 6);
  });

  it('lands the lead-in exactly on the contour start vertex, tangent to the first edge', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'outside', ARC));
    const end = last(lead.leadIn);
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(0, 6);
    // The continuous arc is exactly tangent at the entry; the sampled terminal
    // chord approximates it to within roughly half the arc step (~7.5 deg).
    const tangent = tangentAtEntry(lead.leadIn);
    expect(tangent.x).toBeGreaterThan(0.98); // arrives heading +x, matching the first edge
    expect(Math.abs(tangent.y)).toBeLessThan(0.2);
  });

  it('keeps the arc on the waste side of the entry tangent (never dips toward the part)', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'outside', ARC));
    // Part side of the +x bottom edge is y > 0; every lead-in point must stay y <= 0.
    for (const point of lead.leadIn) expect(point.y).toBeLessThanOrEqual(1e-6);
  });

  it('starts the lead-out on the contour start vertex', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'outside', ARC));
    const start = lead.leadOut[0];
    expect(start?.x).toBeCloseTo(0, 6);
    expect(start?.y).toBeCloseTo(0, 6);
  });

  it('mirrors the waste side for an outside CW profile', () => {
    const lead = ok(computeProfileLead(CW_SQUARE, 'outside', ARC));
    expect(lead.plunge.x).toBeLessThan(0); // exterior of the CW loop is left of the +y edge
    expect(lead.plunge.x).toBeCloseTo(-5, 6);
    expect(lead.plunge.y).toBeCloseTo(-5, 6);
    expect(last(lead.leadIn).x).toBeCloseTo(0, 6);
    expect(last(lead.leadIn).y).toBeCloseTo(0, 6);
  });

  it('plunges into the interior (the hole) for an inside profile', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'inside', ARC));
    expect(lead.plunge.y).toBeGreaterThan(0); // interior of the CCW loop is above the bottom edge
    expect(lead.plunge.x).toBeCloseTo(-5, 6);
    expect(lead.plunge.y).toBeCloseTo(5, 6);
  });

  it('places the plunge on the lead radius circle around the entry offset', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'outside', ARC));
    // arc center sits one radius off the entry on the waste side: (0, -5).
    const distance = Math.hypot(lead.plunge.x - 0, lead.plunge.y - -5);
    expect(distance).toBeCloseTo(5, 6);
  });
});

describe('computeProfileLead — line leads', () => {
  it('approaches straight from the waste to the entry without crossing the contour', () => {
    const lead = ok(computeProfileLead(CCW_SQUARE, 'outside', { shape: 'line', radiusMm: 4 }));
    expect(lead.leadIn).toHaveLength(2);
    expect(lead.plunge.x).toBeCloseTo(0, 6);
    expect(lead.plunge.y).toBeCloseTo(-4, 6); // perpendicular into the exterior
    expect(last(lead.leadIn).y).toBeCloseTo(0, 6);
  });
});

describe('computeProfileLead — refusals', () => {
  it('refuses on-path cuts (no defined waste side)', () => {
    const result = computeProfileLead(CCW_SQUARE, 'on-path', ARC);
    expect(result.ok).toBe(false);
  });

  it('refuses open paths', () => {
    const result = computeProfileLead({ ...CCW_SQUARE, closed: false }, 'outside', ARC);
    expect(result.ok).toBe(false);
  });

  it('refuses sub-three-point rings', () => {
    const twoPoints: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    expect(computeProfileLead(twoPoints, 'outside', ARC).ok).toBe(false);
  });

  it('refuses zero-area (collinear) profiles', () => {
    const collinear: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    expect(computeProfileLead(collinear, 'outside', ARC).ok).toBe(false);
  });

  it('refuses a non-positive or non-finite radius', () => {
    expect(computeProfileLead(CCW_SQUARE, 'outside', { shape: 'arc', radiusMm: 0 }).ok).toBe(false);
    expect(computeProfileLead(CCW_SQUARE, 'outside', { shape: 'arc', radiusMm: NaN }).ok).toBe(
      false,
    );
  });
});
