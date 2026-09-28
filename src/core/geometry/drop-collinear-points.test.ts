import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dropCollinearPoints } from './drop-collinear-points';

type Point = { readonly x: number; readonly y: number; readonly z?: number };

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const ez = (b.z ?? 0) - (a.z ?? 0);
  const length2 = ex * ex + ey * ey + ez * ez;
  const px = p.x - a.x;
  const py = p.y - a.y;
  const pz = (p.z ?? 0) - (a.z ?? 0);
  const t = length2 > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey + pz * ez) / length2)) : 0;
  return Math.hypot(px - t * ex, py - t * ey, pz - t * ez);
}

describe('dropCollinearPoints (ADR-488)', () => {
  it('turns a staircase traced cell by cell into one move per straight run', () => {
    const stairs = [
      { x: 0, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0.8, y: 0 },
      { x: 1, y: 0.2 },
      { x: 1.2, y: 0.4 },
      { x: 1.6, y: 0.4 },
      { x: 2, y: 0.4 },
    ];
    expect(dropCollinearPoints(stairs)).toEqual([
      { x: 0, y: 0 },
      { x: 0.8, y: 0 },
      { x: 1.2, y: 0.4 },
      { x: 2, y: 0.4 },
    ]);
  });

  it('keeps a reversal along the same line and drops repeated points', () => {
    const back = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(dropCollinearPoints(back)).toEqual(back);
    // One emit-grid step off the line is a real corner.
    const kink = [
      { x: 0, y: 0 },
      { x: 1, y: 0.001 },
      { x: 2, y: 0 },
    ];
    expect(dropCollinearPoints(kink)).toEqual(kink);
    const repeats = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(dropCollinearPoints(repeats)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(dropCollinearPoints([])).toEqual([]);
    expect(dropCollinearPoints([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });

  it('merges a ramp along one side but keeps the turn where it levels out', () => {
    const ramp = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: -0.1 },
      { x: 2, y: 0, z: -0.2 },
      { x: 3, y: 0, z: -0.2 },
      { x: 4, y: 0, z: -0.2 },
    ];
    expect(dropCollinearPoints(ramp)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: -0.2 },
      { x: 4, y: 0, z: -0.2 },
    ]);
  });

  it('never changes the path: every dropped point stays on it, in order (300 seeds)', () => {
    const coordinate = fc.integer({ min: -2000, max: 2000 }).map((n) => n / 100);
    const vertex = fc.record({ x: coordinate, y: coordinate, z: coordinate });
    fc.assert(
      fc.property(
        fc.array(vertex, { minLength: 2, maxLength: 8 }),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 8, maxLength: 8 }),
        (corners, splits) => {
          // Split each edge into equal steps, as a traced run is.
          const points: Point[] = [corners[0] as Point];
          corners.slice(1).forEach((b, index) => {
            const a = corners[index] as Point;
            const steps = (splits[index] ?? 0) + 1;
            for (let k = 1; k <= steps; k += 1) {
              const t = k / steps;
              points.push({
                x: a.x + t * (b.x - a.x),
                y: a.y + t * (b.y - a.y),
                z: (a.z ?? 0) + t * ((b.z ?? 0) - (a.z ?? 0)),
              });
            }
          });
          const kept = dropCollinearPoints(points);
          expect(kept[0]).toBe(points[0]);
          expect(kept[kept.length - 1]).toBe(points[points.length - 1]);
          // The kept points are a subsequence, and each dropped run lies on
          // the segment that replaces it.
          let from = 0;
          for (let index = 1; index < kept.length; index += 1) {
            const to = points.indexOf(kept[index] as Point, from + 1);
            expect(to).toBeGreaterThan(from);
            for (let k = from + 1; k < to; k += 1) {
              const skipped = points[k] as Point;
              expect(
                distanceToSegment(skipped, points[from] as Point, points[to] as Point),
              ).toBeLessThan(1e-8);
            }
            from = to;
          }
          expect(kept.length).toBeLessThanOrEqual(corners.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});
