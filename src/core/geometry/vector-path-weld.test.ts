import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob, optimizePaths, type CutGroup } from '../job';
import {
  createLayer,
  DEFAULT_PROJECT_OPTIMIZATION,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Polyline,
  type TextObject,
} from '../scene';
import { weldVectorObjects } from './vector-path-weld';

function rectangle(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  };
}

function artwork(id: string, paths: ReadonlyArray<ColoredPath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function unwrap(result: ReturnType<typeof weldVectorObjects>): ImportedSvg {
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

function signedArea(polyline: Polyline): number {
  return (
    polyline.points.reduce((sum, point, index) => {
      const next = polyline.points[(index + 1) % polyline.points.length];
      return next === undefined ? sum : sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function visibleArea(object: ImportedSvg): number {
  return Math.abs(
    object.paths.flatMap((path) => path.polylines).reduce((sum, path) => sum + signedArea(path), 0),
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

describe('weldVectorObjects render-batch topology', () => {
  it('uses non-zero fill for connected TextObject outlines', () => {
    const text: TextObject = {
      kind: 'text',
      id: 'text',
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
          polylines: [rectangle(0, 0, 10, 10), rectangle(5, 0, 15, 10)],
        },
      ],
    };

    expect(visibleArea(unwrap(weldVectorObjects([text], 'out')))).toBeCloseTo(150, 6);
  });

  it('normalizes same-color ColoredPath entries independently before their union', () => {
    const object = artwork('same-color', [
      { color: '#ff0000', polylines: [rectangle(0, 0, 10, 10)] },
      { color: '#ff0000', polylines: [rectangle(5, 0, 15, 10)] },
    ]);

    const welded = unwrap(weldVectorObjects([object], 'out'));
    expect(visibleArea(welded)).toBeCloseTo(150, 6);
    expect(welded.paths).toHaveLength(1);
    expect(welded.paths[0]?.polylines).toHaveLength(1);
  });

  it('keeps ordinary compound artwork on even-odd fill', () => {
    const donut = artwork('donut', [
      {
        color: '#ff0000',
        polylines: [rectangle(0, 0, 20, 20), rectangle(5, 5, 15, 15)],
      },
    ]);

    expect(visibleArea(unwrap(weldVectorObjects([donut], 'out')))).toBeCloseTo(300, 6);
  });

  it('preserves distinct color and operation batches', () => {
    const object = artwork('multi-output', [
      {
        color: '#ff0000',
        operationIds: ['red-op'],
        polylines: [rectangle(0, 0, 10, 10)],
      },
      {
        color: '#0000ff',
        operationIds: ['blue-op'],
        polylines: [rectangle(5, 0, 15, 10)],
      },
      {
        color: '#ff0000',
        operationIds: ['detail-op'],
        polylines: [rectangle(20, 0, 30, 10)],
      },
    ]);

    expect(
      unwrap(weldVectorObjects([object], 'out')).paths.map((path) => ({
        color: path.color,
        operationIds: path.operationIds,
      })),
    ).toEqual([
      { color: '#ff0000', operationIds: ['red-op'] },
      { color: '#0000ff', operationIds: ['blue-op'] },
      { color: '#ff0000', operationIds: ['detail-op'] },
    ]);
  });

  it('splits multi-bound paths so each operation unions only its own geometry', () => {
    const object = artwork('multi-bound', [
      {
        color: '#ff0000',
        operationIds: ['a', 'b'],
        polylines: [rectangle(0, 0, 10, 10)],
      },
      {
        color: '#ff0000',
        operationIds: ['a'],
        polylines: [rectangle(5, 0, 15, 10)],
      },
    ]);

    const welded = unwrap(weldVectorObjects([object], 'out'));
    const a = welded.paths.find((path) => path.operationIds?.[0] === 'a');
    const b = welded.paths.find((path) => path.operationIds?.[0] === 'b');
    expect(
      Math.abs((a?.polylines ?? []).reduce((sum, path) => sum + signedArea(path), 0)),
    ).toBeCloseTo(150, 6);
    expect(
      Math.abs((b?.polylines ?? []).reduce((sum, path) => sum + signedArea(path), 0)),
    ).toBeCloseTo(100, 6);
  });

  it('bakes rotation, non-uniform scale, and reflection before union', () => {
    const fixtures = [
      {
        id: 'rotated',
        transform: { ...IDENTITY_TRANSFORM, rotationDeg: 37 },
        area: 100,
        bounds: { minX: -6.018, minY: 0, maxX: 7.986, maxY: 14.005 },
      },
      {
        id: 'non-uniform',
        transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 3 },
        area: 600,
        bounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
      },
      {
        id: 'reflected',
        transform: { ...IDENTITY_TRANSFORM, mirrorX: true },
        area: 100,
        bounds: { minX: -10, minY: 0, maxX: 0, maxY: 10 },
      },
    ];

    for (const fixture of fixtures) {
      const source: ImportedSvg = {
        ...artwork(fixture.id, [{ color: '#ff0000', polylines: [rectangle(0, 0, 10, 10)] }]),
        transform: fixture.transform,
      };
      const welded = unwrap(weldVectorObjects([source], 'out'));

      expect(visibleArea(welded), fixture.id).toBeCloseTo(fixture.area, 3);
      expect(welded.bounds.minX, fixture.id).toBeCloseTo(fixture.bounds.minX, 3);
      expect(welded.bounds.minY, fixture.id).toBeCloseTo(fixture.bounds.minY, 3);
      expect(welded.bounds.maxX, fixture.id).toBeCloseTo(fixture.bounds.maxX, 3);
      expect(welded.bounds.maxY, fixture.id).toBeCloseTo(fixture.bounds.maxY, 3);
    }
  });

  it('uses canonical curves at machine tolerance instead of compatibility polylines', () => {
    const curve = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic' as const,
          control1: { x: 0, y: 10 },
          control2: { x: 10, y: 10 },
          to: { x: 10, y: 0 },
        },
        { kind: 'line' as const, to: { x: 0, y: 0 } },
      ],
      closed: true,
    };
    const coarse = flattenCurveSubpath(curve, { toleranceMm: 0.25 });
    const machine = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
    if (coarse.kind !== 'ok' || machine.kind !== 'ok') throw new Error('curve fixture failed');
    const source: ImportedSvg = {
      ...artwork('curve', [
        {
          color: '#ff0000',
          polylines: [coarse.polyline],
          curves: [curve],
        },
      ]),
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 7.5 },
    };

    const welded = unwrap(weldVectorObjects([source], 'out'));
    const result = welded.paths[0]?.polylines[0];
    expect(result?.points).toHaveLength(machine.polyline.points.length);
    expect(Math.abs(result === undefined ? 0 : signedArea(result))).toBeCloseTo(
      Math.abs(signedArea(machine.polyline)),
      3,
    );
  });

  it('stores equivalent disjoint input in identical raw path order', () => {
    const objects = [
      artwork('right', [{ color: '#ff0000', polylines: [rectangle(40, 0, 50, 10)] }]),
      artwork('left', [{ color: '#ff0000', polylines: [rectangle(0, 0, 10, 10)] }]),
      artwork('middle', [{ color: '#ff0000', polylines: [rectangle(20, 0, 30, 10)] }]),
    ];
    const expectedObject = unwrap(weldVectorObjects(objects, 'first'));
    const expected = expectedObject.paths;
    const expectedCompiled = compiledSourceOrder(expectedObject);

    for (const ordered of permutations(objects)) {
      const welded = unwrap(weldVectorObjects(ordered, 'out'));
      expect(welded.paths).toEqual(expected);
      expect(compiledSourceOrder(welded)).toEqual(expectedCompiled);
    }
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
