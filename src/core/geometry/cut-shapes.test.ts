import { areaD } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline } from '../scene';
import { createEllipse } from '../shapes/primitives';
import { planCutShapes, type CutShapesPlan } from './cut-shapes';
import type { VectorSceneObject } from './vector-path-tools';

type Point = readonly [number, number];

function poly(points: ReadonlyArray<Point>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function square(x: number, y: number, size: number): Polyline {
  return poly(
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    true,
  );
}

function art(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

function plan(objects: ReadonlyArray<VectorSceneObject>): CutShapesPlan {
  const result = planCutShapes(objects, new Set(objects.map((object) => object.id)));
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

function area(object: ImportedSvg): number {
  return object.paths
    .flatMap((path) => path.polylines)
    .reduce((sum, polyline) => sum + areaD(polyline.points.map((point) => ({ ...point }))), 0);
}

describe('Cut Shapes', () => {
  it('cuts the shape behind with the front shape into inside and outside pieces', () => {
    const back = art('back', [square(0, 0, 20)], { powerScale: 0.5 });
    const front = art('front', [square(10, 10, 20)], { operationIds: ['engrave'] });
    const result = plan([back, front]);
    expect(result.cutterId).toBe('front');
    expect(result.cuts).toHaveLength(1);
    const [outside, inside] = result.cuts[0]?.pieces ?? [];
    expect(outside).toMatchObject({
      id: 'back-outside',
      source: 'back.svg (outside)',
      operationIds: ['cut'],
      powerScale: 0.5,
      transform: IDENTITY_TRANSFORM,
    });
    expect(inside).toMatchObject({ id: 'back-inside', operationIds: ['cut'] });
    expect(Math.abs(area(outside as ImportedSvg))).toBeCloseTo(300, 6);
    expect(Math.abs(area(inside as ImportedSvg))).toBeCloseTo(100, 6);
    expect(inside?.bounds).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
  });

  it('uses the top-most closed shape even when an open path lies above it', () => {
    const circle = createEllipse({
      id: 'disc',
      color: '#00ff00',
      spec: { widthMm: 20, heightMm: 20 },
    });
    const line = art(
      'line',
      [
        poly([
          [-10, 10],
          [30, 10],
        ]),
      ],
      {
        paths: [
          {
            color: '#ff0000',
            operationIds: ['score'],
            polylines: [
              poly([
                [-10, 10],
                [30, 10],
              ]),
            ],
          },
        ],
      },
    );
    const result = plan([circle, line]);
    expect(result.cutterId).toBe('disc');
    const [outside, inside] = result.cuts[0]!.pieces;
    const insidePath = inside.paths[0]!;
    expect(insidePath).toMatchObject({ color: '#ff0000', operationIds: ['score'] });
    expect(insidePath.polylines).toHaveLength(1);
    expect(insidePath.polylines[0]!.closed).toBe(false);
    expect(outside.paths[0]!.polylines).toHaveLength(2);
    const insideXs = insidePath.polylines[0]!.points.map((point) => point.x);
    expect(Math.min(...insideXs)).toBeCloseTo(0, 2);
    expect(Math.max(...insideXs)).toBeCloseTo(20, 2);
  });

  it('keeps each path colour on its own piece', () => {
    const twoTone: ImportedSvg = art('two-tone', [], {
      paths: [
        { color: '#ff0000', polylines: [square(0, 0, 10)] },
        { color: '#0000ff', polylines: [square(20, 0, 10)] },
      ],
    });
    const band = art('band', [
      poly(
        [
          [5, -5],
          [25, -5],
          [25, 15],
          [5, 15],
        ],
        true,
      ),
    ]);
    const [outside, inside] = plan([twoTone, band]).cuts[0]?.pieces ?? [];
    expect(inside?.paths.map((path) => path.color)).toEqual(['#ff0000', '#0000ff']);
    expect(outside?.paths.map((path) => path.color)).toEqual(['#ff0000', '#0000ff']);
  });

  it('leaves shapes the cutter does not cross exactly as they were', () => {
    const crossed = art('crossed', [square(0, 0, 20)]);
    const inside = art('inside', [square(12, 12, 2)]);
    const cutter = art('cutter', [square(10, 10, 20)]);
    const result = plan([crossed, inside, cutter]);
    expect(result.cuts.map((cut) => cut.sourceId)).toEqual(['crossed']);
  });

  it('explains a selection it cannot cut', () => {
    const one = planCutShapes([art('a', [square(0, 0, 10)])], new Set());
    expect(one).toMatchObject({ kind: 'error', error: { kind: 'too-few-objects' } });
    const open = planCutShapes(
      [
        art('a', [
          poly([
            [0, 0],
            [10, 10],
          ]),
        ]),
        art('b', [
          poly([
            [0, 10],
            [10, 0],
          ]),
        ]),
      ],
      new Set(),
    );
    expect(open).toMatchObject({ kind: 'error', error: { kind: 'no-cutter' } });
    const apart = planCutShapes(
      [art('a', [square(0, 0, 10)]), art('b', [square(50, 0, 10)])],
      new Set(),
    );
    expect(apart).toMatchObject({ kind: 'error', error: { kind: 'nothing-cut' } });
  });

  it('gives every piece an unused id', () => {
    const back = art('back', [square(0, 0, 20)]);
    const front = art('front', [square(10, 10, 20)]);
    const result = planCutShapes([back, front], new Set(['back', 'front', 'back-inside']));
    expect(result.kind === 'ok' && result.value.cuts[0]?.pieces.map((piece) => piece.id)).toEqual([
      'back-outside',
      'back-inside-2',
    ]);
  });
});
