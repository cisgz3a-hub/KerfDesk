import { describe, expect, it } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type SceneObject,
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

function foreground(kind: 'shape' | 'text' | 'imported-svg' | 'raster-image'): SceneObject {
  const common = {
    id: 'foreground',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    color: '#000000',
  };
  const paths = [box(0, 100)];
  switch (kind) {
    case 'shape':
      return {
        ...common,
        kind,
        paths,
        spec: { kind: 'rect', widthMm: 100, heightMm: 100, cornerRadiusMm: 0 },
      };
    case 'text':
      return {
        ...common,
        kind,
        paths,
        content: 'Text',
        fontKey: 'roboto',
        sizeMm: 100,
        alignment: 'left',
        lineHeight: 1,
        letterSpacing: 0,
      };
    case 'imported-svg':
      return { ...common, kind, paths, source: 'foreground.svg' };
    case 'raster-image':
      return {
        ...common,
        kind,
        source: 'foreground.png',
        dataUrl: 'data:image/png;base64,AA==',
        pixelWidth: 1,
        pixelHeight: 1,
        dither: 'threshold',
        linesPerMm: 1,
      };
  }
}

describe('ordinary artwork above a trace', () => {
  it.each(['shape', 'text', 'imported-svg', 'raster-image'] as const)(
    'does not pick an invisible lower trace through a painted %s',
    (kind) => {
      expect(
        hitTracePart(
          { objects: [trace([under]), foreground(kind)], layers },
          { x: 50, y: 50 },
          0.1,
        ),
      ).toBeNull();
      expect(
        hitTracePart({ objects: [foreground(kind), trace([under])], layers }, { x: 50, y: 50 }, 0.1)
          ?.objectId,
      ).toBe('trace');
    },
  );

  it.each(['hole', 'line', 'hidden', 'wireframe', 'empty', 'locked'] as const)(
    'allows picking through the %s area of foreground artwork',
    (condition) => {
      const object = foreground('imported-svg');
      if (object.kind !== 'imported-svg') throw new Error('Expected SVG');
      const outer = box(0, 100);
      const front = {
        ...object,
        locked: condition === 'locked',
        paths:
          condition === 'empty'
            ? []
            : [
                condition === 'hole'
                  ? { ...outer, polylines: [...outer.polylines, ...box(20, 80).polylines] }
                  : outer,
              ],
      };
      const scene = {
        objects: [trace([under]), front],
        layers: layers.map((layer) =>
          layer.id !== 'fill'
            ? layer
            : {
                ...layer,
                visible: condition !== 'hidden',
                mode: condition === 'line' ? ('line' as const) : layer.mode,
              },
        ),
      };
      expect(hitTracePart(scene, { x: 50, y: 50 }, 0.1, condition === 'wireframe')?.objectId).toBe(
        'trace',
      );
    },
  );

  it('blocks a visible foreground stroke but not the empty area inside its bounds', () => {
    const object = foreground('imported-svg');
    if (object.kind !== 'imported-svg') throw new Error('Expected SVG');
    const scene = { objects: [trace([under]), { ...object, paths: [under] }], layers };
    expect(hitTracePart(scene, { x: 50, y: 50 }, 0.1)).toBeNull();
    expect(
      hitTracePart(
        { ...scene, objects: [trace([under]), { ...object, paths: [box(0, 10)] }] },
        { x: 50, y: 50 },
        0.1,
      )?.objectId,
    ).toBe('trace');
  });

  it('uses text nonzero winding by default and honors an explicit evenodd hole', () => {
    const text = foreground('text');
    if (text.kind !== 'text') throw new Error('Expected text');
    const path = {
      color: '#000000',
      polylines: [...box(0, 100).polylines, ...box(20, 80).polylines],
    };
    expect(
      hitTracePart(
        { objects: [trace([under]), { ...text, paths: [path] }], layers },
        { x: 50, y: 50 },
        0.1,
      ),
    ).toBeNull();
    expect(
      hitTracePart(
        {
          objects: [trace([under]), { ...text, paths: [{ ...path, fillRule: 'evenodd' }] }],
          layers,
        },
        { x: 50, y: 50 },
        0.1,
      )?.objectId,
    ).toBe('trace');
  });

  it('uses the transformed raster rectangle rather than its expanded axis-aligned box', () => {
    const front = {
      ...foreground('raster-image'),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    expect(
      hitTracePart({ objects: [trace([under]), front], layers }, { x: 50, y: 50 }, 0.1),
    ).toBeNull();
    expect(
      hitTracePart({ objects: [trace([under]), front], layers }, { x: 70, y: 50 }, 0.1)?.objectId,
    ).toBe('trace');
  });
});

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
