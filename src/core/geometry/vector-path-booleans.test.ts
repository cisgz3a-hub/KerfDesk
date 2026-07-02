// Boolean combine + offset (ADR-102 G1): subject/clip semantics, per-op
// results on overlapping rectangles, empty-result and open-contour errors,
// and offset area growth/shrink with round joins.

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { combineVectorObjects, offsetVectorObjects } from './vector-path-booleans';

function rectObject(id: string, x0: number, y0: number, x1: number, y1: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 },
            ],
          },
        ],
      },
    ],
  };
}

function polygonArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function totalArea(object: ImportedSvg): number {
  let area = 0;
  for (const path of object.paths) {
    for (const polyline of path.polylines) {
      area += polygonArea(polyline.points);
    }
  }
  return area;
}

// 10×10 subject at origin; 10×10 clip shifted +5 in x → 5×10 overlap.
const SUBJECT = rectObject('a', 0, 0, 10, 10);
const CLIP = rectObject('b', 5, 0, 15, 10);

describe('combineVectorObjects', () => {
  it('subtract removes the clip from the bottom-most subject', () => {
    const result = combineVectorObjects([SUBJECT, CLIP], 'subtract', 'out');
    expect(totalArea(result)).toBeCloseTo(50, 6);
    expect(result.bounds.maxX).toBeCloseTo(5, 6);
    expect(result.paths[0]?.color).toBe('#ff0000');
  });

  it('intersect keeps only the overlap', () => {
    const result = combineVectorObjects([SUBJECT, CLIP], 'intersect', 'out');
    expect(totalArea(result)).toBeCloseTo(50, 6);
    expect(result.bounds).toMatchObject({ minX: 5, maxX: 10 });
  });

  it('exclude keeps both non-overlapping parts', () => {
    const result = combineVectorObjects([SUBJECT, CLIP], 'exclude', 'out');
    expect(totalArea(result)).toBeCloseTo(100, 6);
    expect(result.bounds).toMatchObject({ minX: 0, maxX: 15 });
  });

  it('bakes the object transform into world space before combining', () => {
    // Clip drawn at origin but translated +5 in x by its transform.
    const movedClip: ImportedSvg = {
      ...rectObject('b', 0, 0, 10, 10),
      transform: { ...IDENTITY_TRANSFORM, x: 5 },
    };
    const result = combineVectorObjects([SUBJECT, movedClip], 'subtract', 'out');
    expect(totalArea(result)).toBeCloseTo(50, 6);
  });

  it('rejects a non-overlapping intersect as an empty result', () => {
    const far = rectObject('c', 100, 100, 110, 110);
    expect(() => combineVectorObjects([SUBJECT, far], 'intersect', 'out')).toThrow(/empty/i);
  });

  it('rejects fewer than two objects and open contours', () => {
    expect(() => combineVectorObjects([SUBJECT], 'subtract', 'out')).toThrow(/two or more/i);
    const open: ImportedSvg = {
      ...rectObject('d', 0, 0, 4, 4),
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    expect(() => combineVectorObjects([SUBJECT, open], 'subtract', 'out')).toThrow(/closed/i);
  });
});

describe('offsetVectorObjects', () => {
  it('outward offset grows the shape by the distance on every side', () => {
    const result = offsetVectorObjects([SUBJECT], 2, 'out');
    expect(result.bounds.minX).toBeCloseTo(-2, 3);
    expect(result.bounds.maxX).toBeCloseTo(12, 3);
    // Rounded corners: area sits between the square-corner bound and the
    // exact rounded-corner value (14×14 − corner deficit).
    expect(totalArea(result)).toBeGreaterThan(180);
    expect(totalArea(result)).toBeLessThan(196);
  });

  it('inward offset shrinks the shape', () => {
    const result = offsetVectorObjects([SUBJECT], -2, 'out');
    expect(totalArea(result)).toBeCloseTo(36, 3);
  });

  it('rejects a collapse-to-nothing inward offset and a zero distance', () => {
    expect(() => offsetVectorObjects([SUBJECT], -6, 'out')).toThrow(/collapsed/i);
    expect(() => offsetVectorObjects([SUBJECT], 0, 'out')).toThrow(/non-zero/i);
  });
});
