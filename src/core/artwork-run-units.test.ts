import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type SceneObject } from './scene';
import { artworkRunUnits, moveArtworkRunUnitsToPosition } from './artwork-run-units';

describe('artwork run units', () => {
  it('groups artwork with the same complete operation set', () => {
    const scene = fixtureScene([
      object('A', ['shared']),
      object('B', ['unique']),
      object('C', ['shared']),
    ]);

    expect(artworkRunUnits(scene).map((unit) => unit.objectIds)).toEqual([['A', 'C'], ['B']]);
  });

  it('keeps partial sharing as separate run units', () => {
    const scene = fixtureScene([object('A', ['shared', 'detail']), object('B', ['shared'])]);

    expect(artworkRunUnits(scene).map((unit) => unit.objectIds)).toEqual([['A'], ['B']]);
  });

  it('moves complete shared units to a direct one-based position', () => {
    const scene = fixtureScene([
      object('A', ['shared']),
      object('B', ['unique']),
      object('C', ['shared']),
      object('D', ['detail']),
    ]);

    expect(moveArtworkRunUnitsToPosition(scene, new Set(['B']), 3)).toEqual(['A', 'C', 'D', 'B']);
    expect(moveArtworkRunUnitsToPosition(scene, new Set(['C']), 2)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('accumulates a large same-operation run without rebuilding prior members', () => {
    const objects = Array.from({ length: 4_000 }, (_, index) => object(`O${index}`, ['shared']));

    const units = artworkRunUnits(fixtureScene(objects));

    expect(units).toHaveLength(1);
    expect(units[0]?.objectIds).toHaveLength(objects.length);
    expect(units[0]?.objectIds[0]).toBe('O0');
    expect(units[0]?.objectIds.at(-1)).toBe('O3999');
  });
});

function fixtureScene(objects: ReadonlyArray<SceneObject>): Scene {
  return {
    objects,
    layers: ['shared', 'unique', 'detail'].map((id, index) =>
      createLayer({
        id,
        name: id,
        color: ['#2563eb', '#dc2626', '#16a34a'][index] ?? '#64748b',
      }),
    ),
  };
}

function object(id: string, operationIds: ReadonlyArray<string>): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    operationIds,
  };
}
