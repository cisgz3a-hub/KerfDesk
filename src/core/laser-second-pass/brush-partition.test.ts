import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildBrushIndex, visitBrushCandidates } from './brush-index';
import { partitionBrushPower } from './brush-partition';
import { maskScaleAt } from './program-oracle.test-helper';
import type {
  LaserSecondPassSegment,
  LaserSecondPassSelection,
  LaserSecondPassStroke,
} from './types';

function line(x0: number, y0: number, x1: number, y1: number): LaserSecondPassSegment {
  return {
    from: { x: x0, y: y0 },
    to: { x: x1, y: y1 },
    power: 200,
    feed: 600,
    mode: 4,
    rapid: false,
  };
}

function selection(strokes: ReadonlyArray<LaserSecondPassStroke>): LaserSecondPassSelection {
  return { version: 1, maxPowerS: 1000, strokes };
}

function dot(
  x: number,
  y: number,
  radiusMm: number,
  mode: 'paint' | 'erase' = 'paint',
  powerScale = 1,
): LaserSecondPassStroke {
  return { id: 'dot', mode, powerScale, radiusMm, points: [{ x, y }] };
}

describe('analytic paintbrush intersection', () => {
  it('finds the circle chord rather than a sampled or rectangular footprint', () => {
    const brush = selection([dot(5, 0, 2)]);
    const result = partitionBrushPower(line(0, 1, 10, 1), buildBrushIndex(brush), brush.strokes);
    expect(result).toHaveLength(3);
    expect(result[1]?.start).toBeCloseTo((5 - Math.sqrt(3)) / 10, 14);
    expect(result[1]?.end).toBeCloseTo((5 + Math.sqrt(3)) / 10, 14);
    expect(result[1]?.scale).toBe(1);
  });

  it('ignores a point tangency but keeps a straight capsule boundary', () => {
    const circle = selection([dot(5, 0, 1)]);
    expect(partitionBrushPower(line(0, 1, 10, 1), buildBrushIndex(circle), circle.strokes)).toEqual(
      [{ start: 0, end: 1, scale: 0 }],
    );
    const body = selection([
      {
        ...dot(2, 0, 1),
        points: [
          { x: 2, y: 0 },
          { x: 8, y: 0 },
        ],
      },
    ]);
    expect(partitionBrushPower(line(0, 1, 10, 1), buildBrushIndex(body), body.strokes)).toEqual([
      { start: 0, end: 0.2, scale: 0 },
      { start: 0.2, end: 0.8, scale: 1 },
      { start: 0.8, end: 1, scale: 0 },
    ]);
  });

  it('unions self-overlap and resolves erase/repaint by the last covering stroke', () => {
    const brush = selection([
      {
        ...dot(2, 0, 1),
        points: [
          { x: 2, y: 0 },
          { x: 8, y: 0 },
          { x: 2, y: 0 },
        ],
      },
      dot(5, 0, 2, 'paint', 0.5),
      dot(5, 0, 1, 'erase'),
      dot(5, 0, 0.25, 'paint', 1.5),
    ]);
    expect(partitionBrushPower(line(0, 0, 10, 0), buildBrushIndex(brush), brush.strokes)).toEqual([
      { start: 0, end: 0.1, scale: 0 },
      { start: 0.1, end: 0.3, scale: 1 },
      { start: 0.3, end: 0.4, scale: 0.5 },
      { start: 0.4, end: 0.475, scale: 0 },
      { start: 0.475, end: 0.525, scale: 1.5 },
      { start: 0.525, end: 0.6, scale: 0 },
      { start: 0.6, end: 0.7, scale: 0.5 },
      { start: 0.7, end: 0.9, scale: 1 },
      { start: 0.9, end: 1, scale: 0 },
    ]);
  });

  it('agrees with an independent distance-to-polyline oracle for arbitrary directions and brush overlap', () => {
    const point = fc.record({
      x: fc.integer({ min: -100, max: 100 }),
      y: fc.integer({ min: -100, max: 100 }),
    });
    const stroke = fc.record({
      id: fc.constant('stroke'),
      mode: fc.constantFrom('paint' as const, 'erase' as const),
      radiusMm: fc.integer({ min: 1, max: 30 }),
      powerScale: fc.constantFrom(0, 0.4, 1, 1.7),
      points: fc.array(point, { minLength: 1, maxLength: 5 }),
    });
    fc.assert(
      fc.property(
        point,
        point,
        fc.array(stroke, { minLength: 1, maxLength: 9 }),
        (from, to, strokes) => {
          fc.pre(from.x !== to.x || from.y !== to.y);
          const segment = { ...line(0, 0, 1, 1), from, to };
          const brush = selection(strokes);
          const intervals = partitionBrushPower(segment, buildBrushIndex(brush), strokes);
          expect(intervals[0]?.start).toBe(0);
          expect(intervals.at(-1)?.end).toBe(1);
          for (let sample = 0; sample < 257; sample += 1) {
            const t = (sample + 0.371) / 257;
            const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
            const matches = intervals.filter((interval) => t >= interval.start && t < interval.end);
            expect(matches).toHaveLength(1);
            expect(matches[0]?.scale).toBe(maskScaleAt(point, strokes));
          }
        },
      ),
      { seed: 928461, numRuns: 150 },
    );
  });

  it('queries local capsule bounds without visiting thousands of distant brush edges', () => {
    const brush = selection(Array.from({ length: 10000 }, (_, i) => dot(i * 20, i * 20, 1)));
    const index = buildBrushIndex(brush);
    let candidates = 0;
    visitBrushCandidates(index, { minX: -2, minY: 0, maxX: 2, maxY: 0 }, () => (candidates += 1));
    expect(candidates).toBe(1);
  });
});
