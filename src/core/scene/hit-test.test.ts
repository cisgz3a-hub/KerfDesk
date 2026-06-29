import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import { EMPTY_SCENE, addObject, type Scene } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import { hitTest, transformedBBox } from './hit-test';

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

function withObjects(...objs: SceneObject[]): Scene {
  const colors = new Set(
    objs.flatMap((o) => (o.kind === 'raster-image' ? [o.color] : o.paths.map((p) => p.color))),
  );
  const scene = {
    ...EMPTY_SCENE,
    layers: [...colors].map((color) => createLayer({ id: color, color })),
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
