import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import { EMPTY_SCENE, addObject, type Scene } from './scene';
import { IDENTITY_TRANSFORM, type Polyline, type SceneObject } from './scene-object';
import { hitTest, transformedBBox } from './hit-test';
import { hitTestCandidates } from './hit-test-candidates';

function obj(args: {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  tx?: number;
  ty?: number;
  locked?: boolean;
  color?: string;
}): SceneObject {
  const color = args.color ?? '#ff0000';
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    ...(args.locked === undefined ? {} : { locked: args.locked }),
    bounds: { minX: args.minX, minY: args.minY, maxX: args.maxX, maxY: args.maxY },
    transform: { ...IDENTITY_TRANSFORM, x: args.tx ?? 0, y: args.ty ?? 0 },
    paths: [{ color, polylines: [] }],
  };
}

function outlinedRect(args: {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  color?: string;
}): SceneObject {
  const color = args.color ?? '#ff0000';
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: args.minX, minY: args.minY, maxX: args.maxX, maxY: args.maxY },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [rectPolyline(args)] }],
  };
}

function rectPolyline(args: { minX: number; minY: number; maxX: number; maxY: number }): Polyline {
  return {
    closed: true,
    points: [
      { x: args.minX, y: args.minY },
      { x: args.maxX, y: args.minY },
      { x: args.maxX, y: args.maxY },
      { x: args.minX, y: args.maxY },
    ],
  };
}

function withObjects(...objs: SceneObject[]): Scene {
  return withObjectsAndLayerModes(new Map(), ...objs);
}

function withObjectsAndLayerModes(
  modes: ReadonlyMap<string, 'line' | 'fill' | 'image'>,
  ...objs: SceneObject[]
): Scene {
  const colors = new Set(
    objs.flatMap((o) =>
      o.kind === 'raster-image' || o.kind === 'relief' ? [o.color] : o.paths.map((p) => p.color),
    ),
  );
  const scene = {
    ...EMPTY_SCENE,
    layers: [...colors].map((color) => {
      const mode = modes.get(color);
      return mode === undefined
        ? createLayer({ id: color, color })
        : createLayer({ id: color, color, mode });
    }),
  };
  return objs.reduce<Scene>((acc, o) => addObject(acc, o), scene);
}

describe('transformedBBox', () => {
  it('returns the natural bounds when transform is identity', () => {
    const o = obj({ id: 'X', minX: 0, minY: 0, maxX: 10, maxY: 20 });
    expect(transformedBBox(o)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
  });

  it('applies the translation portion of the transform', () => {
    const o = obj({ id: 'X', minX: 0, minY: 0, maxX: 10, maxY: 20, tx: 100, ty: 50 });
    expect(transformedBBox(o)).toEqual({ minX: 100, minY: 50, maxX: 110, maxY: 70 });
  });
});

describe('hitTest', () => {
  it('selects the canonical curve rather than its compatibility chord', () => {
    const color = '#ff0000';
    const curve: SceneObject = {
      kind: 'imported-svg',
      id: 'curve',
      source: 'curve.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 7.5 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color,
          polylines: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              closed: false,
            },
          ],
          curves: [
            {
              start: { x: 0, y: 0 },
              segments: [
                {
                  kind: 'cubic',
                  control1: { x: 0, y: 10 },
                  control2: { x: 10, y: 10 },
                  to: { x: 10, y: 0 },
                },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    expect(hitTest(withObjects(curve), { x: 5, y: 7.5 })).toBe('curve');
  });

  it('returns null for an empty scene', () => {
    expect(hitTest(EMPTY_SCENE, { x: 5, y: 5 })).toBeNull();
  });

  it('returns the object id when the point is inside its bbox', () => {
    const scene = withObjects(obj({ id: 'A', minX: 0, minY: 0, maxX: 10, maxY: 10 }));
    expect(hitTest(scene, { x: 5, y: 5 })).toBe('A');
  });

  it('returns null when the point is outside every object', () => {
    const scene = withObjects(obj({ id: 'A', minX: 0, minY: 0, maxX: 10, maxY: 10 }));
    expect(hitTest(scene, { x: 50, y: 50 })).toBeNull();
  });

  it('rejects vector objects outside their expanded bounds before walking path geometry', () => {
    const throwingPolyline = {
      closed: true,
      get points(): ReadonlyArray<{ readonly x: number; readonly y: number }> {
        throw new Error('walked polyline geometry');
      },
    };
    const scene = withObjects({
      kind: 'imported-svg',
      id: 'A',
      source: 'A.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#ff0000', polylines: [throwingPolyline] }],
    });

    expect(hitTest(scene, { x: 50, y: 50 })).toBeNull();
  });

  it('prefers the topmost object when bboxes overlap', () => {
    // 'B' added second → rendered on top → hit first.
    const scene = withObjects(
      obj({ id: 'A', minX: 0, minY: 0, maxX: 20, maxY: 20 }),
      obj({ id: 'B', minX: 5, minY: 5, maxX: 15, maxY: 15 }),
    );
    expect(hitTest(scene, { x: 10, y: 10 })).toBe('B');
    // Outside B but inside A → falls through to A.
    expect(hitTest(scene, { x: 18, y: 18 })).toBe('A');
  });

  it('prefers the smaller closed outline under the pointer over a larger outline above it', () => {
    const inner = outlinedRect({ id: 'inner', minX: 30, minY: 30, maxX: 45, maxY: 45 });
    const outer = outlinedRect({ id: 'outer', minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const scene = withObjects(inner, outer);

    expect(hitTest(scene, { x: 35, y: 35 })).toBe('inner');
    expect(hitTest(scene, { x: 1, y: 50 })).toBe('outer');
  });

  it('keeps filled top objects selectable through their interior', () => {
    const inner = outlinedRect({
      id: 'inner',
      minX: 30,
      minY: 30,
      maxX: 45,
      maxY: 45,
      color: '#00ff00',
    });
    const outer = outlinedRect({
      id: 'outer',
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
      color: '#0000ff',
    });
    const scene = withObjectsAndLayerModes(new Map([['#0000ff', 'fill']]), inner, outer);

    expect(hitTest(scene, { x: 35, y: 35 })).toBe('outer');
  });

  it('skips locked objects and hits the next unlocked object underneath', () => {
    const scene = withObjects(
      obj({ id: 'A', minX: 0, minY: 0, maxX: 20, maxY: 20 }),
      obj({ id: 'B', minX: 5, minY: 5, maxX: 15, maxY: 15, locked: true }),
    );

    expect(hitTest(scene, { x: 10, y: 10 })).toBe('A');
  });

  it('skips objects whose assigned layer is hidden', () => {
    const scene = withObjects(
      obj({ id: 'A', minX: 0, minY: 0, maxX: 20, maxY: 20, color: '#ff0000' }),
      obj({ id: 'B', minX: 5, minY: 5, maxX: 15, maxY: 15, color: '#0000ff' }),
    );

    expect(
      hitTest(
        {
          ...scene,
          layers: scene.layers.map((layer) =>
            layer.id === '#0000ff' ? { ...layer, visible: false } : layer,
          ),
        },
        { x: 10, y: 10 },
      ),
    ).toBe('A');
  });
});

describe('hitTestCandidates', () => {
  it('returns every overlapping object from topmost to bottommost', () => {
    const scene = withObjects(
      obj({ id: 'bottom', minX: 0, minY: 0, maxX: 20, maxY: 20 }),
      obj({ id: 'top', minX: 0, minY: 0, maxX: 20, maxY: 20 }),
    );

    expect(hitTestCandidates(scene, { x: 10, y: 10 })).toEqual(['top', 'bottom']);
  });

  it('keeps direct geometry ahead of enclosing line interiors', () => {
    const inner = outlinedRect({ id: 'inner', minX: 30, minY: 30, maxX: 45, maxY: 45 });
    const outer = outlinedRect({ id: 'outer', minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const scene = withObjects(inner, outer);

    expect(hitTestCandidates(scene, { x: 35, y: 35 })).toEqual(['inner', 'outer']);
  });

  it('omits locked objects from the overlap cycle', () => {
    const scene = withObjects(
      obj({ id: 'bottom', minX: 0, minY: 0, maxX: 20, maxY: 20 }),
      obj({ id: 'locked', minX: 0, minY: 0, maxX: 20, maxY: 20, locked: true }),
    );

    expect(hitTestCandidates(scene, { x: 10, y: 10 })).toEqual(['bottom']);
  });
});
