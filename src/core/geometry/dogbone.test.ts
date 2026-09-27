// Dogbone corner relief (ADR-103 G6, Amd 1): the compensated bit must reach
// every sharp convex corner in one loop, reflex corners untouched, errors on
// no-op selections. The relief is judged on the inside-profile toolpath (the
// first ring of a pocket), never on the drawn shape: the pre-amendment
// vertex-centred circle looked right and left the toolpath unchanged.

import { describe, expect, it } from 'vitest';
import { type Result } from '../result';
import { profileToolpathPolylines } from '../cnc/profile-paths';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline, type Vec2 } from '../scene';
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

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Closest approach of the bit centre to `corner` along the closed toolpath.
function bitCentreDistance(corner: Vec2, loops: ReadonlyArray<Polyline>): number {
  let best = Number.POSITIVE_INFINITY;
  for (const loop of loops) {
    const points = loop.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      best = Math.min(best, segmentDistance(corner, a, b));
    }
  }
  return best;
}

function insideToolpath(object: ImportedSvg, toolMm: number): ReadonlyArray<Polyline> {
  return profileToolpathPolylines(object.paths[0]?.polylines ?? [], 'inside', toolMm);
}

describe('dogboneVectorObject', () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ];

  it('lets the bit reach all four corners of a square slot in one loop', () => {
    const toolMm = 6.35;
    const result = unwrap(dogboneVectorObject(SQUARE, toolMm));
    const toolpath = insideToolpath(result, toolMm);
    expect(toolpath).toHaveLength(1);
    for (const corner of corners) {
      expect(bitCentreDistance(corner, toolpath)).toBeLessThanOrEqual(toolMm / 2);
    }
    // Without relief the bit centre stops √2·r from each corner.
    const plain = insideToolpath(SQUARE, toolMm);
    expect(bitCentreDistance({ x: 0, y: 0 }, plain)).toBeCloseTo(Math.SQRT2 * (toolMm / 2), 2);
    expect(result.source).toBe('square (dogbone)');
    expect(result.id).toBe('square');
  });

  it('reaches acute and obtuse corners too', () => {
    const triangle = pathObject('triangle', [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
    ]);
    const hexagon = pathObject(
      'hexagon',
      Array.from({ length: 6 }, (_, i) => ({
        x: 15 * Math.cos((i * Math.PI) / 3),
        y: 15 * Math.sin((i * Math.PI) / 3),
      })),
    );
    for (const shape of [triangle, hexagon]) {
      const toolMm = 3.175;
      const toolpath = insideToolpath(unwrap(dogboneVectorObject(shape, toolMm)), toolMm);
      expect(toolpath).toHaveLength(1);
      for (const corner of shape.paths[0]?.polylines[0]?.points ?? []) {
        expect(bitCentreDistance(corner, toolpath)).toBeLessThanOrEqual(toolMm / 2);
      }
    }
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
