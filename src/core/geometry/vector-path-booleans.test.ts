// Boolean combine + offset (ADR-103 G1): subject/clip semantics, per-op
// results on overlapping rectangles, empty-result and open-contour errors,
// and offset area growth/shrink with round joins.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob, optimizePaths, type CutGroup } from '../job';
import { type Result } from '../result';
import {
  createLayer,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type TextObject,
} from '../scene';
import { combineVectorObjects, offsetVectorObjects } from './vector-path-booleans';
import { type VectorOpError } from './vector-path-tools';

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

function signedPolygonArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
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

function filledArea(object: ImportedSvg): number {
  return Math.abs(
    object.paths
      .flatMap((path) => path.polylines)
      .reduce((sum, polyline) => {
        return sum + signedPolygonArea(polyline.points);
      }, 0),
  );
}

function permutations<T>(values: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index)).map((tail) => [
      value,
      ...tail,
    ]),
  );
}

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

// 10×10 subject at origin; 10×10 clip shifted +5 in x → 5×10 overlap.
const SUBJECT = rectObject('a', 0, 0, 10, 10);
const CLIP = rectObject('b', 5, 0, 15, 10);

describe('combineVectorObjects', () => {
  it('subtract removes the clip from the bottom-most subject', () => {
    const result = unwrap(combineVectorObjects([SUBJECT, CLIP], 'subtract', 'out'));
    expect(totalArea(result)).toBeCloseTo(50, 6);
    expect(result.bounds.maxX).toBeCloseTo(5, 6);
    expect(result.paths[0]?.color).toBe('#ff0000');
  });

  it('intersect keeps only the overlap', () => {
    const result = unwrap(combineVectorObjects([SUBJECT, CLIP], 'intersect', 'out'));
    expect(totalArea(result)).toBeCloseTo(50, 6);
    expect(result.bounds).toMatchObject({ minX: 5, maxX: 10 });
  });

  it('exclude keeps both non-overlapping parts', () => {
    const result = unwrap(combineVectorObjects([SUBJECT, CLIP], 'exclude', 'out'));
    expect(totalArea(result)).toBeCloseTo(100, 6);
    expect(result.bounds).toMatchObject({ minX: 0, maxX: 15 });
  });

  it('reduces every operand for three-way intersect and parity exclude in every order', () => {
    const a = rectObject('a', 0, 0, 10, 10);
    const b = rectObject('b', 0, 0, 6, 10);
    const c = rectObject('c', 4, 0, 10, 10);

    for (const ordered of permutations([a, b, c])) {
      expect(filledArea(unwrap(combineVectorObjects(ordered, 'intersect', 'out')))).toBeCloseTo(
        20,
        6,
      );
      expect(filledArea(unwrap(combineVectorObjects(ordered, 'exclude', 'out')))).toBeCloseTo(
        20,
        6,
      );
    }
  });

  it('uses non-zero fill inside TextObject batches before cross-object combination', () => {
    const text: TextObject = {
      kind: 'text',
      id: 'connected-script',
      content: 'connected',
      fontKey: 'builtin:sans',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            rectObject('left', 0, 0, 10, 10).paths[0]?.polylines[0] as NonNullable<
              ImportedSvg['paths'][number]['polylines'][number]
            >,
            rectObject('right', 5, 0, 15, 10).paths[0]?.polylines[0] as NonNullable<
              ImportedSvg['paths'][number]['polylines'][number]
            >,
          ],
        },
      ],
    };
    const enclosing = rectObject('box', -1, -1, 16, 11);
    const interiorClip = rectObject('interior-clip', 7, 0, 12, 10);

    expect(
      filledArea(unwrap(combineVectorObjects([text, enclosing], 'intersect', 'out'))),
    ).toBeCloseTo(150, 6);
    expect(
      filledArea(unwrap(combineVectorObjects([text, interiorClip], 'subtract', 'out'))),
    ).toBeCloseTo(100, 6);
    expect(
      filledArea(unwrap(combineVectorObjects([text, interiorClip], 'exclude', 'out'))),
    ).toBeCloseTo(100, 6);
    expect(filledArea(unwrap(offsetVectorObjects([text], 0.25, 'offset')))).toBeCloseTo(162.696, 2);
  });

  it('normalizes each artwork ColoredPath independently before combining batches', () => {
    const artwork: ImportedSvg = {
      ...rectObject('multi-batch', 0, 0, 15, 10),
      paths: [
        { color: '#ff0000', polylines: [rectObject('r', 0, 0, 10, 10).paths[0]!.polylines[0]!] },
        { color: '#0000ff', polylines: [rectObject('b', 5, 0, 15, 10).paths[0]!.polylines[0]!] },
      ],
    };
    const duplicateColor: ImportedSvg = {
      ...artwork,
      id: 'same-color-batches',
      paths: artwork.paths.map((path) => ({ ...path, color: '#ff0000' })),
    };
    const enclosing = rectObject('box', -1, -1, 16, 11);

    for (const object of [artwork, duplicateColor]) {
      expect(
        filledArea(unwrap(combineVectorObjects([object, enclosing], 'intersect', 'out'))),
      ).toBeCloseTo(150, 6);
      const offset = unwrap(offsetVectorObjects([object], 0.25, 'offset'));
      expect(filledArea(offset)).toBeCloseTo(162.696, 2);
      expect(offset.paths[0]?.polylines).toHaveLength(1);
    }
  });

  it('keeps ordinary compound artwork on its established even-odd fill rule', () => {
    const donut: ImportedSvg = {
      ...rectObject('donut', 0, 0, 20, 20),
      paths: [
        {
          color: '#ff0000',
          polylines: [
            rectObject('outer', 0, 0, 20, 20).paths[0]!.polylines[0]!,
            rectObject('inner', 5, 5, 15, 15).paths[0]!.polylines[0]!,
          ],
        },
      ],
    };
    const enclosing = rectObject('box', -1, -1, 21, 21);

    expect(
      filledArea(unwrap(combineVectorObjects([donut, enclosing], 'intersect', 'out'))),
    ).toBeCloseTo(300, 6);
  });

  it('preserves subject output metadata through Boolean and Offset results', () => {
    const subject: ImportedSvg = {
      ...SUBJECT,
      powerScale: 25,
      operationOverride: { mode: 'fill', power: 90, speed: 321 },
    };

    const combined = unwrap(combineVectorObjects([subject, CLIP], 'intersect', 'combined'));
    const offset = unwrap(offsetVectorObjects([subject], 1, 'offset'));
    for (const result of [combined, offset]) {
      expect(result.powerScale).toBe(25);
      expect(result.operationOverride).toEqual({ mode: 'fill', power: 90, speed: 321 });
    }
  });

  it('stores n-ary parity output in deterministic raw path order', () => {
    const objects = [
      rectObject('right', 40, 0, 50, 10),
      rectObject('left', 0, 0, 10, 10),
      rectObject('middle', 20, 0, 30, 10),
    ];
    const expected = unwrap(combineVectorObjects(objects, 'exclude', 'first')).paths[0]?.polylines;

    for (const ordered of permutations(objects)) {
      expect(unwrap(combineVectorObjects(ordered, 'exclude', 'out')).paths[0]?.polylines).toEqual(
        expected,
      );
    }
  });

  it('stores and compiles transformed n-ary commutative results independent of operand order', () => {
    const objects: ImportedSvg[] = [
      {
        ...rectObject('a', 0, 0, 12, 7),
        transform: {
          ...IDENTITY_TRANSFORM,
          x: 4,
          y: 2,
          scaleX: 1.4,
          scaleY: 0.9,
          rotationDeg: 34,
          mirrorX: true,
        },
      },
      {
        ...rectObject('b', 2, 1, 11, 9),
        transform: {
          ...IDENTITY_TRANSFORM,
          x: 2,
          y: 2,
          scaleX: 1.3,
          scaleY: 1.2,
          rotationDeg: 62,
        },
      },
      {
        ...rectObject('c', 4, -2, 12, 9),
        transform: {
          ...IDENTITY_TRANSFORM,
          x: 2,
          y: 2,
          scaleX: 1.1,
          scaleY: 0.9,
          rotationDeg: 86,
        },
      },
    ];

    for (const op of ['intersect', 'exclude'] as const) {
      const expectedObject = unwrap(combineVectorObjects(objects, op, 'expected'));
      const expectedPaths = expectedObject.paths;
      const expectedCompiled = compiledSourceOrder(expectedObject);
      for (const ordered of permutations(objects)) {
        const combined = unwrap(combineVectorObjects(ordered, op, 'out'));
        expect(combined.paths, op).toEqual(expectedPaths);
        expect(compiledSourceOrder(combined), op).toEqual(expectedCompiled);
      }
    }
  });

  it('bakes rotation, non-uniform scale, and reflection into Boolean and Offset geometry', () => {
    const enclosing = rectObject('enclosing', -100, -100, 100, 100);
    const fixtures = [
      {
        id: 'rotated',
        transform: { ...IDENTITY_TRANSFORM, rotationDeg: 37 },
        area: 100,
        offsetArea: 110.196,
        bounds: { minX: -6.018, minY: 0, maxX: 7.986, maxY: 14.005 },
      },
      {
        id: 'non-uniform',
        transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3 },
        area: 600,
        offsetArea: 625.196,
        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
      },
      {
        id: 'reflected',
        transform: { ...IDENTITY_TRANSFORM, mirrorX: true },
        area: 100,
        offsetArea: 110.196,
        bounds: { minX: -10, minY: 0, maxX: 0, maxY: 10 },
      },
    ];

    for (const fixture of fixtures) {
      const object: ImportedSvg = {
        ...rectObject(fixture.id, 0, 0, 10, 10),
        transform: fixture.transform,
      };
      const combined = unwrap(combineVectorObjects([object, enclosing], 'intersect', 'out'));
      const offset = unwrap(offsetVectorObjects([object], 0.25, 'offset'));

      expect(filledArea(combined), fixture.id).toBeCloseTo(fixture.area, 3);
      expect(filledArea(offset), fixture.id).toBeCloseTo(fixture.offsetArea, 1);
      expect(combined.bounds.minX, fixture.id).toBeCloseTo(fixture.bounds.minX, 3);
      expect(combined.bounds.minY, fixture.id).toBeCloseTo(fixture.bounds.minY, 3);
      expect(combined.bounds.maxX, fixture.id).toBeCloseTo(fixture.bounds.maxX, 3);
      expect(combined.bounds.maxY, fixture.id).toBeCloseTo(fixture.bounds.maxY, 3);
    }
  });

  it('rejects a non-overlapping intersect as an empty result', () => {
    const far = rectObject('c', 100, 100, 110, 110);
    expectErr(combineVectorObjects([SUBJECT, far], 'intersect', 'out'), 'empty-result', /empty/i);
  });

  it('rejects fewer than two objects and open contours', () => {
    expectErr(
      combineVectorObjects([SUBJECT], 'subtract', 'out'),
      'too-few-objects',
      /two or more/i,
    );
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
    expectErr(combineVectorObjects([SUBJECT, open], 'subtract', 'out'), 'open-contours', /closed/i);
  });
});

function compiledSourceOrder(object: ImportedSvg) {
  const layer = createLayer({ id: 'red', color: '#ff0000' });
  const job = optimizePaths(
    compileJob({ objects: [object], layers: [layer], groups: [] }, DEFAULT_DEVICE_PROFILE),
    {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      travelPolicy: 'source-order',
      pathDirection: 'preserve',
    },
  );
  return (job.groups[0] as CutGroup | undefined)?.segments;
}

describe('offsetVectorObjects', () => {
  it('outward offset grows the shape by the distance on every side', () => {
    const result = unwrap(offsetVectorObjects([SUBJECT], 2, 'out'));
    expect(result.bounds.minX).toBeCloseTo(-2, 3);
    expect(result.bounds.maxX).toBeCloseTo(12, 3);
    // Rounded corners: area sits between the square-corner bound and the
    // exact rounded-corner value (14×14 − corner deficit).
    expect(totalArea(result)).toBeGreaterThan(180);
    expect(totalArea(result)).toBeLessThan(196);
  });

  it('inward offset shrinks the shape', () => {
    const result = unwrap(offsetVectorObjects([SUBJECT], -2, 'out'));
    expect(totalArea(result)).toBeCloseTo(36, 3);
  });

  it('rejects a collapse-to-nothing inward offset and a zero distance', () => {
    expectErr(offsetVectorObjects([SUBJECT], -6, 'out'), 'collapsed', /collapsed/i);
    expectErr(offsetVectorObjects([SUBJECT], 0, 'out'), 'bad-distance', /non-zero/i);
  });
});
