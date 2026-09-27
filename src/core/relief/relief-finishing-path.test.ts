import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FINISHING_REDUCTION_TOLERANCE_MM,
  reduceFinishingPath,
  type FinishingPoint,
} from './relief-finishing-path';

const TOLERANCE = FINISHING_REDUCTION_TOLERANCE_MM;
// Floating-point slack on a linear interpolation of millimetre coordinates.
const ROUNDING_MM = 1e-12;

// The Z of a polyline at XY station s along its (single-line) path.
function pathZ(path: ReadonlyArray<FinishingPoint>, x: number): number {
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a === undefined || b === undefined) continue;
    const low = Math.min(a.x, b.x);
    const high = Math.max(a.x, b.x);
    if (x < low || x > high) continue;
    return a.x === b.x ? Math.max(a.z, b.z) : a.z + ((b.z - a.z) * (x - a.x)) / (b.x - a.x);
  }
  throw new Error(`station ${String(x)} is off the path`);
}

function row(zs: ReadonlyArray<number>, pitch = 0.25): FinishingPoint[] {
  return zs.map((z, index) => ({ x: index * pitch, y: 1, z }));
}

describe('reduceFinishingPath (ADR-421)', () => {
  it('keeps only the ends of a flat row', () => {
    expect(reduceFinishingPath(row([-2, -2, -2, -2, -2]))).toEqual([
      { x: 0, y: 1, z: -2 },
      { x: 1, y: 1, z: -2 },
    ]);
  });

  it('keeps the ends of a straight slope', () => {
    expect(reduceFinishingPath(row([-1, -1.5, -2, -2.5]))).toEqual([
      { x: 0, y: 1, z: -1 },
      { x: 0.75, y: 1, z: -2.5 },
    ]);
  });

  it('never skips a vertex the straight segment would pass below', () => {
    // A ridge: the chord from the first to the last vertex runs under the peak.
    const ridge = row([-2, -1.999, -2]);
    expect(reduceFinishingPath(ridge)).toEqual(ridge);
  });

  it('skips a dip no deeper than the tolerance, leaving at most that much stock', () => {
    const dip = row([-2, -2 - TOLERANCE / 2, -2]);
    expect(reduceFinishingPath(dip)).toEqual([dip[0], dip[2]]);
    const deeper = row([-2, -2 - 2 * TOLERANCE, -2]);
    expect(reduceFinishingPath(deeper)).toEqual(deeper);
  });

  it('keeps every corner of a serpentine link', () => {
    const path: FinishingPoint[] = [
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: -1 },
      { x: 1, y: 0.5, z: -1 },
      { x: 1, y: 1, z: -1 },
      { x: 0, y: 1, z: -1 },
    ];
    expect(reduceFinishingPath(path)).toEqual([path[0], path[1], path[3], path[4]]);
  });

  it('keeps a vertical move', () => {
    const plunge: FinishingPoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: -1 },
    ];
    expect(reduceFinishingPath(plunge)).toEqual(plunge);
  });

  it('never moves the tool lower, and adds at most the tolerance, anywhere on the row', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -400, max: 0 }), { minLength: 3, maxLength: 40 }),
        fc.constantFrom(1, 1e-3, 1e-4),
        (steps, scale) => {
          const original = row(steps.map((step) => step * scale));
          const reduced = reduceFinishingPath(original);
          expect(reduced[0]).toEqual(original[0]);
          expect(reduced.at(-1)).toEqual(original.at(-1));
          for (let index = 0; index < original.length; index += 1) {
            const vertex = original[index];
            if (vertex === undefined) continue;
            const z = pathZ(reduced, vertex.x);
            expect(z).toBeGreaterThanOrEqual(vertex.z - ROUNDING_MM);
            expect(z).toBeLessThanOrEqual(vertex.z + TOLERANCE + ROUNDING_MM);
            const next = original[index + 1];
            if (next === undefined) continue;
            const middle = (vertex.x + next.x) / 2;
            expect(pathZ(reduced, middle)).toBeGreaterThanOrEqual(
              (vertex.z + next.z) / 2 - ROUNDING_MM,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
