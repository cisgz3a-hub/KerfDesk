import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type TracedImage,
} from '../../core/scene';
import { hitTracePart } from './trace-part-hit-test';

function box(min: number, max: number): ColoredPath {
  return {
    color: '#000000',
    fillRule: 'evenodd',
    polylines: [
      {
        closed: true,
        points: [
          { x: min, y: min },
          { x: max, y: min },
          { x: max, y: max },
          { x: min, y: max },
        ],
      },
    ],
  };
}

function trace(paths: ReadonlyArray<ColoredPath>): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'image.png',
    traceMode: 'filled-contours',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    paths,
  };
}

const under: ColoredPath = {
  color: '#ff0000',
  polylines: [
    {
      closed: false,
      points: [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
    },
  ],
};
const layers = [
  createLayer({ id: 'line', color: '#ff0000', mode: 'line' }),
  createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
];

describe('paint order within a traced image', () => {
  it('picks a later opaque fill over the exact hidden edge of an earlier colour', () => {
    expect(
      hitTracePart({ objects: [trace([under, box(0, 100)])], layers }, { x: 50, y: 50 }, 0.1),
    ).toEqual({ objectId: 'trace', pathIndex: 1, subpathIndex: 0 });
  });

  it('leaves a nearer visible stroke above a filled colour pickable', () => {
    expect(
      hitTracePart({ objects: [trace([box(0, 100), under])], layers }, { x: 50, y: 50 }, 0.1)
        ?.pathIndex,
    ).toBe(1);
  });

  it.each(['hole', 'hidden', 'wireframe'] as const)(
    'allows the lower edge through a %s fill',
    (condition) => {
      const outer = box(0, 100);
      const fill =
        condition === 'hole'
          ? { ...outer, polylines: [...outer.polylines, ...box(20, 80).polylines] }
          : outer;
      const scene = {
        objects: [trace([under, fill])],
        layers: layers.map((layer) =>
          condition === 'hidden' && layer.id === 'fill' ? { ...layer, visible: false } : layer,
        ),
      };
      expect(hitTracePart(scene, { x: 50, y: 50 }, 0.1, condition === 'wireframe')?.pathIndex).toBe(
        0,
      );
    },
  );

  it('picks a filled Centerline island rather than the enclosing outline group', () => {
    const outer = box(0, 100);
    const path = {
      ...outer,
      polylines: [...outer.polylines, ...box(20, 80).polylines, ...box(40, 60).polylines],
    };
    const object = { ...trace([path]), traceMode: 'centerline' as const };
    expect(hitTracePart({ objects: [object], layers }, { x: 50, y: 50 }, 0.1)).toEqual({
      objectId: 'trace',
      pathIndex: 0,
      subpathIndex: 2,
    });
  });
});
