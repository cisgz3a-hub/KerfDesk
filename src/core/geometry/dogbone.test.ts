// Dogbone corner relief (ADR-103 G6): vertex-centered overcut circles on
// sharp convex corners, reflex corners untouched, islands skipped, errors
// on no-op selections.

import { describe, expect, it } from 'vitest';
import { type Result } from '../result';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { dogboneVectorObject } from './dogbone';
import { type VectorOpError } from './vector-path-tools';

function pathObject(id: string, points: ReadonlyArray<{ x: number; y: number }>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
  };
}

const SQUARE = pathObject('square', [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
]);

function unwrap(result: Result<ImportedSvg, VectorOpError>): ImportedSvg {
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

function expectErr(
  result: Result<unknown, VectorOpError>,
  kind: VectorOpError['kind'],
  pattern: RegExp,
): void {
  expect(result.kind).toBe('error');
  if (result.kind === 'error') {
    expect(result.error.kind).toBe(kind);
    expect(result.error.message).toMatch(pattern);
  }
}

function totalArea(object: ImportedSvg): number {
  let area = 0;
  for (const path of object.paths) {
    for (const polyline of path.polylines) {
      let sum = 0;
      const pts = polyline.points;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a === undefined || b === undefined) continue;
        sum += a.x * b.y - b.x * a.y;
      }
      area += Math.abs(sum) / 2;
    }
  }
  return area;
}

describe('dogboneVectorObject', () => {
  it('relieves all four corners of a square with vertex-centered circles', () => {
    const result = unwrap(dogboneVectorObject(SQUARE, 6.35));
    const r = 6.35 / 2;
    // The circles push the bounds out by one radius at every corner.
    expect(result.bounds.minX).toBeCloseTo(-r, 2);
    expect(result.bounds.maxX).toBeCloseTo(20 + r, 2);
    // Each corner adds ~3/4 of a circle outside the square.
    const expected = 400 + 4 * 0.75 * Math.PI * r * r;
    expect(totalArea(result)).toBeGreaterThan(400);
    expect(Math.abs(totalArea(result) - expected)).toBeLessThan(3);
    expect(result.source).toBe('square (dogbone)');
    expect(result.id).toBe('square');
  });

  it('leaves the reflex corner of an L-shape alone', () => {
    const ell = pathObject('ell', [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
    const result = unwrap(dogboneVectorObject(ell, 4));
    // 5 convex 90° corners relieved; the inner reflex (270°) corner is not:
    // no relief circle reaches past (10,10) into the notch interior beyond r.
    const insideNotch = result.paths[0]?.polylines.every((poly) =>
      poly.points.every((p) => !(p.x > 12.5 && p.x < 17.5 && p.y > 12.5 && p.y < 17.5)),
    );
    expect(insideNotch).toBe(true);
    expect(totalArea(result)).toBeGreaterThan(300);
  });

  it('returns a typed error when nothing qualifies (obtuse polygon) or contours are open', () => {
    // Regular 12-gon: interior angles 150° — clearly above the threshold.
    const twelveGon = pathObject(
      'twelve',
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * 2 * Math.PI;
        return { x: 10 + 8 * Math.cos(a), y: 10 + 8 * Math.sin(a) };
      }),
    );
    expectErr(dogboneVectorObject(twelveGon, 3.175), 'no-corners', /no corners/i);

    const open: ImportedSvg = {
      ...SQUARE,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    expectErr(dogboneVectorObject(open, 3.175), 'open-contours', /closed/i);
    expectErr(dogboneVectorObject(SQUARE, 0), 'bad-distance', /positive/i);
  });
});
