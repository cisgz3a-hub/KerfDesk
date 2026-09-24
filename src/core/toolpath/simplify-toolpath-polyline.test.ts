import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { polylineDeviationBounds } from '../../__fixtures__/polyline-deviation-bounds';
import type { Polyline, Vec2 } from '../scene';
import {
  simplifyToolpathPolyline,
  type ToolpathSimplifyOptions,
} from './simplify-toolpath-polyline';

const TOLERANCE_MM = 0.025;
const OPTIONS: ToolpathSimplifyOptions = {
  mmPerUnitX: 1,
  mmPerUnitY: 1,
  toleranceMm: TOLERANCE_MM,
  cornerAngleDeg: 60,
};
const ORACLE_ERROR_MM = 1e-4;
const CIRCLE_RADIUS_MM = 10;
// A 10 mm circle sampled every ~0.07 mm, the pitch the audit measured.
const CIRCLE_SAMPLES = 900;
// Fewest chords within 0.025 mm of a 10 mm circle: each spans at most
// 2*acos(1 - 0.025/10) rad, so at least 45 of them are needed.
const CIRCLE_MIN_CHORDS = 45;
const CIRCLE_MAX_CHORDS = 2 * CIRCLE_MIN_CHORDS;
const PROPERTY_RUNS = 60;
const PROPERTY_SEED = 20_260_924;

function circle(samples: number, radius: number): Polyline {
  const points: Vec2[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (2 * Math.PI * index) / samples;
    points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  points.push(points[0] as Vec2);
  return { points, closed: true };
}

function densify(corners: ReadonlyArray<Vec2>, pitch: number): Vec2[] {
  const points: Vec2[] = [corners[0] as Vec2];
  for (let index = 1; index < corners.length; index += 1) {
    const a = corners[index - 1] as Vec2;
    const b = corners[index] as Vec2;
    const count = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / pitch));
    for (let part = 1; part <= count; part += 1) {
      points.push({ x: a.x + ((b.x - a.x) * part) / count, y: a.y + ((b.y - a.y) * part) / count });
    }
  }
  return points;
}

function toMm(points: ReadonlyArray<Vec2>, options: ToolpathSimplifyOptions): Vec2[] {
  return points.map((point) => ({
    x: point.x * options.mmPerUnitX,
    y: point.y * options.mmPerUnitY,
  }));
}

function expectSubsequence(kept: ReadonlyArray<Vec2>, source: ReadonlyArray<Vec2>): void {
  let cursor = 0;
  for (const point of kept) {
    while (cursor < source.length && source[cursor] !== point) cursor += 1;
    expect(cursor).toBeLessThan(source.length);
    cursor += 1;
  }
}

function turnDeg(previous: Vec2, at: Vec2, next: Vec2): number {
  const inX = at.x - previous.x;
  const inY = at.y - previous.y;
  const outX = next.x - at.x;
  const outY = next.y - at.y;
  return (Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY)) * 180) / Math.PI;
}

describe('simplifyToolpathPolyline', () => {
  it('replaces a densely sampled circle with the few chords the tolerance allows', () => {
    const source = circle(CIRCLE_SAMPLES, CIRCLE_RADIUS_MM);
    const simplified = simplifyToolpathPolyline(source, OPTIONS);
    const chords = simplified.points.length - 1;
    expect(chords).toBeGreaterThanOrEqual(CIRCLE_MIN_CHORDS);
    expect(chords).toBeLessThanOrEqual(CIRCLE_MAX_CHORDS);
    expect(simplified.closed).toBe(true);
    expect(simplified.points[0]).toBe(source.points[0]);
    expect(simplified.points.at(-1)).toBe(source.points.at(-1));
    expectSubsequence(simplified.points, source.points);
    const deviation = polylineDeviationBounds(source.points, simplified.points, ORACLE_ERROR_MM);
    expect(deviation.upperBound).toBeLessThanOrEqual(TOLERANCE_MM + ORACLE_ERROR_MM);
  });

  it('measures the tolerance in millimetres on each axis', () => {
    const options = { ...OPTIONS, mmPerUnitX: 2, mmPerUnitY: 0.5 };
    // 0.02 units off a horizontal chord is 0.01 mm; off a vertical chord, 0.04 mm.
    const horizontal: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0.02 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    const vertical: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 0.02, y: 5 },
        { x: 0, y: 10 },
      ],
      closed: false,
    };
    expect(simplifyToolpathPolyline(horizontal, options).points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(simplifyToolpathPolyline(vertical, options)).toBe(vertical);
  });

  it('keeps drawn corners exactly, including repeated and sub-tolerance ones', () => {
    const square = densify(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
        { x: 0, y: 0 },
      ],
      0.07,
    );
    // A repeated vertex at one corner, and a 0.01 mm step on the top edge
    // whose two 90-degree turns stay inside the tolerance of a straight move.
    const corner = square.findIndex((point) => point.x === 20 && point.y === 0);
    square.splice(corner, 0, { x: 20, y: 0 });
    const stepAt = square.findIndex((point) => point.y === 20 && point.x > 10 && point.x < 15);
    const step = square[stepAt] as Vec2;
    square.splice(stepAt + 1, 0, { x: step.x, y: 20.01 }, { x: step.x - 0.01, y: 20.01 });
    const source: Polyline = { points: square, closed: true };
    expect(simplifyToolpathPolyline(source, OPTIONS).points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      step,
      { x: step.x, y: 20.01 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ]);
  });

  it('keeps both ends of an open chain and removes collinear repeats', () => {
    const chain: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    expect(simplifyToolpathPolyline(chain, OPTIONS)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    });
  });

  it('never collapses a ring that fits inside the tolerance', () => {
    const tiny = circle(12, 0.01);
    expect(simplifyToolpathPolyline(tiny, OPTIONS)).toBe(tiny);
    const implicit: Polyline = { points: tiny.points.slice(0, -1), closed: true };
    expect(simplifyToolpathPolyline(implicit, OPTIONS)).toBe(implicit);
  });

  it('returns the input when nothing can go or the options are unusable', () => {
    const triangle: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 8 },
        { x: 0, y: 0 },
      ],
      closed: true,
    };
    expect(simplifyToolpathPolyline(triangle, OPTIONS)).toBe(triangle);
    const source = circle(CIRCLE_SAMPLES, CIRCLE_RADIUS_MM);
    for (const broken of [
      { ...OPTIONS, mmPerUnitX: 0 },
      { ...OPTIONS, mmPerUnitY: Number.NaN },
      { ...OPTIONS, toleranceMm: -1 },
      { ...OPTIONS, toleranceMm: Number.POSITIVE_INFINITY },
      { ...OPTIONS, cornerAngleDeg: Number.NaN },
    ]) {
      expect(simplifyToolpathPolyline(source, broken)).toBe(source);
    }
  });

  it('stays within the tolerance, in order, with every corner kept', () => {
    const step = fc.record({
      length: fc.double({ min: 0.01, max: 0.2, noNaN: true }),
      turn: fc.double({ min: -1.4, max: 1.4, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(step, { minLength: 3, maxLength: 160 }),
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.boolean(),
        (steps, mmPerUnitX, mmPerUnitY, closed) => {
          const options = { ...OPTIONS, mmPerUnitX, mmPerUnitY };
          let heading = 0;
          const points: Vec2[] = [{ x: 0, y: 0 }];
          for (const { length, turn } of steps) {
            heading += turn;
            const last = points.at(-1) as Vec2;
            points.push({
              x: last.x + length * Math.cos(heading),
              y: last.y + length * Math.sin(heading),
            });
          }
          if (closed) points.push(points[0] as Vec2);
          const source: Polyline = { points, closed };
          const simplified = simplifyToolpathPolyline(source, options);
          expectSubsequence(simplified.points, points);
          expect(simplified.points[0]).toBe(points[0]);
          expect(simplified.points.at(-1)).toBe(points.at(-1));
          const mm = toMm(points, options);
          for (let index = 1; index < points.length - 1; index += 1) {
            const turn = turnDeg(mm[index - 1] as Vec2, mm[index] as Vec2, mm[index + 1] as Vec2);
            if (turn >= options.cornerAngleDeg) expect(simplified.points).toContain(points[index]);
          }
          const deviation = polylineDeviationBounds(
            mm,
            toMm(simplified.points, options),
            ORACLE_ERROR_MM,
          );
          expect(deviation.upperBound).toBeLessThanOrEqual(TOLERANCE_MM + ORACLE_ERROR_MM);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });
});
