import { expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { combineVectorObjects } from './vector-path-booleans';
import { unionVectorObjects } from './vector-path-union';
import { rubberBandOutline } from './rubber-band-outline';
import { offsetShapes } from './offset-shapes';

function rectangle(id: string, x: number, y: number, width: number, height: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + width, y },
              { x: x + width, y: y + height },
              { x, y: y + height },
              { x, y },
            ],
          },
        ],
      },
    ],
  };
}

// Independent shoelace oracle; no polygon engine functions determine the expected areas.
function area(object: ImportedSvg): number {
  return Math.abs(
    object.paths
      .flatMap((path) => path.polylines)
      .reduce((sum, line) => {
        return (
          sum +
          line.points.reduce((value, a, index) => {
            const b = line.points[(index + 1) % line.points.length]!;
            return value + (a.x * b.y - a.y * b.x) / 2;
          }, 0)
        );
      }, 0),
  );
}

it('matches independent rectangle set areas for 100 translated boolean cases', () => {
  for (let index = 0; index < 100; index += 1) {
    const x = index * 13.25 - 700;
    const a = rectangle('a', x, -10, 20, 10);
    const b = rectangle('b', x + 7, -6, 20, 10);
    for (const [op, expected] of [
      ['subtract', 122],
      ['intersect', 78],
      ['exclude', 244],
    ] as const) {
      const result = combineVectorObjects([a, b], op, 'result');
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') expect(area(result.value)).toBeCloseTo(expected, 6);
    }
  }
});

it('unions a 1000-object overlapping chain without gaps or duplicated area', () => {
  const objects = Array.from({ length: 1000 }, (_, index) =>
    rectangle(String(index), index, 0, 2, 3),
  );
  const result = unionVectorObjects(objects, { id: 'cut', color: '#000000' }, 'union');
  expect(result.kind).toBe('ok');
  if (result.kind === 'ok') {
    expect(area(result.value)).toBeCloseTo(3003, 6);
    expect(result.value.paths[0]?.polylines).toHaveLength(1);
  }
});

it('builds the enclosing hull for 10000 rectangles with collinear duplicate corners', () => {
  const objects = Array.from({ length: 10000 }, (_, index) =>
    rectangle(String(index), index % 100, Math.floor(index / 100), 1, 1),
  );
  const result = rubberBandOutline(objects, 'hull');
  expect(result?.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  expect(area(result!)).toBe(10000);
  expect(result?.paths[0]?.polylines[0]?.points).toHaveLength(5);
});

it('offsets 250 separated squares with independently known corner-join area', () => {
  const objects = Array.from({ length: 250 }, (_, index) =>
    rectangle(String(index), index * 20, 0, 10, 10),
  );
  const result = offsetShapes(
    objects,
    { distanceMm: 1, direction: 'both', cornerStyle: 'corner', outerShapesOnly: false },
    { outward: 'out', inward: 'in' },
  );
  expect(result.kind).toBe('ok');
  if (result.kind === 'ok') {
    expect(area(result.value.outward!)).toBeCloseTo(250 * 144, 6);
    expect(area(result.value.inward!)).toBeCloseTo(250 * 64, 6);
  }
});
