import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline, type Vec2 } from '../scene';
import { offsetShapes, type OffsetShapesOptions } from './offset-shapes';

const IDS = { outward: 'out', inward: 'in' };

function square(minX: number, minY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
  };
}

function art(polylines: ReadonlyArray<Polyline>, id = 'art'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: 'test.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines }],
  };
}

function options(patch: Partial<OffsetShapesOptions>): OffsetShapesOptions {
  return {
    distanceMm: 1,
    direction: 'outward',
    cornerStyle: 'round',
    outerShapesOnly: false,
    ...patch,
  };
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// Outer rings and holes wind opposite ways, so the signed sum is the filled area.
function filledArea(object: ImportedSvg | null): number {
  if (object === null) return 0;
  const total = object.paths
    .flatMap((path) => path.polylines)
    .reduce((sum, polyline) => sum + signedArea(polyline.points), 0);
  return Math.abs(total);
}

function run(objects: ReadonlyArray<ImportedSvg>, patch: Partial<OffsetShapesOptions>) {
  const result = offsetShapes(objects, options(patch), IDS);
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value;
}

describe('offsetShapes corner styles', () => {
  const box = [art([square(0, 0, 10)])];

  it('rounds, bevels or keeps the outward corners of a square', () => {
    expect(filledArea(run(box, { cornerStyle: 'round' }).outward)).toBeCloseTo(140 + Math.PI, 1);
    expect(filledArea(run(box, { cornerStyle: 'bevel' }).outward)).toBeCloseTo(142, 2);
    expect(filledArea(run(box, { cornerStyle: 'corner' }).outward)).toBeCloseTo(144, 2);
  });

  it('keeps sharp corners inward whatever the style, as LightBurn documents', () => {
    for (const cornerStyle of ['round', 'bevel', 'corner'] as const) {
      const result = run(box, { direction: 'inward', cornerStyle });
      expect(result.outward).toBeNull();
      expect(filledArea(result.inward)).toBeCloseTo(64, 2);
    }
  });

  it('makes two new objects for Both', () => {
    const result = run(box, { direction: 'both', cornerStyle: 'corner', distanceMm: 2 });
    expect(result.outward?.id).toBe('out');
    expect(result.inward?.id).toBe('in');
    expect(filledArea(result.outward)).toBeCloseTo(196, 2);
    expect(filledArea(result.inward)).toBeCloseTo(36, 2);
    expect(result.outward?.paths[0]?.color).toBe('#ff0000');
  });
});

describe('offsetShapes outer shapes only', () => {
  // A 20 mm frame with an 8 mm window and a 2 mm island inside the window.
  const frame = [art([square(0, 0, 20), square(6, 6, 8), square(9, 9, 2)])];

  it('keeps holes and islands by default', () => {
    const ringCount = run(frame, { cornerStyle: 'corner' }).outward!.paths[0]!.polylines.length;
    expect(ringCount).toBe(3);
  });

  it('offsets only the outer border when asked', () => {
    const outward = run(frame, { cornerStyle: 'corner', outerShapesOnly: true }).outward!;
    expect(outward.paths[0]!.polylines).toHaveLength(1);
    expect(filledArea(outward)).toBeCloseTo(22 * 22, 2);
  });
});

describe('offsetShapes open paths', () => {
  const line = [
    art([
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ]),
  ];

  it('outlines an open line outward with caps that follow the corner style', () => {
    expect(filledArea(run(line, { cornerStyle: 'round' }).outward)).toBeCloseTo(20 + Math.PI, 1);
    expect(filledArea(run(line, { cornerStyle: 'bevel' }).outward)).toBeCloseTo(20, 2);
    expect(filledArea(run(line, { cornerStyle: 'corner' }).outward)).toBeCloseTo(24, 2);
  });

  it('merges open and closed shapes into one outward outline', () => {
    const mixed = [
      art([square(0, 0, 10)], 'a'),
      art(
        [
          {
            closed: false,
            points: [
              { x: 10, y: 5 },
              { x: 20, y: 5 },
            ],
          },
        ],
        'b',
      ),
    ];
    const outward = run(mixed, { cornerStyle: 'corner' }).outward!;
    expect(outward.paths[0]!.polylines).toHaveLength(1);
  });

  it('outlines only the open lines under Both', () => {
    const result = run(line, { direction: 'both' });
    expect(result.outward).not.toBeNull();
    expect(result.inward).toBeNull();
  });

  it('explains that Inward needs a closed shape', () => {
    const result = offsetShapes(line, options({ direction: 'inward' }), IDS);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('open-contours');
  });
});

describe('offsetShapes errors', () => {
  it('reports a collapsed inward offset', () => {
    const result = offsetShapes(
      [art([square(0, 0, 4)])],
      options({ direction: 'inward', distanceMm: 3 }),
      IDS,
    );
    expect(result.kind === 'error' && result.error.kind).toBe('collapsed');
  });

  it('drops a collapsed inward half of Both and keeps the outward half', () => {
    const result = run([art([square(0, 0, 4)])], { direction: 'both', distanceMm: 3 });
    expect(result.outward).not.toBeNull();
    expect(result.inward).toBeNull();
  });

  it('refuses a zero, negative or non-finite distance', () => {
    for (const distanceMm of [0, -1, Number.NaN]) {
      const result = offsetShapes([art([square(0, 0, 10)])], options({ distanceMm }), IDS);
      expect(result.kind === 'error' && result.error.kind).toBe('bad-distance');
    }
  });

  it('needs at least one object', () => {
    const result = offsetShapes([], options({}), IDS);
    expect(result.kind === 'error' && result.error.kind).toBe('too-few-objects');
  });
});
