import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import type { Scene } from './scene';
import { EMPTY_SCENE } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import { filterSceneForOutputScope, validateOutputScope, type OutputScope } from './output-scope';

function selectedScope(ids: ReadonlyArray<string>): OutputScope {
  return {
    cutSelectedGraphics: true,
    useSelectionOrigin: false,
    selectedObjectIds: ids,
  };
}

describe('output scope', () => {
  it('returns the original scene when Cut Selected Graphics is off', () => {
    const scene = sceneWithObjects(['A', 'B']);

    const filtered = filterSceneForOutputScope(scene, {
      cutSelectedGraphics: false,
      useSelectionOrigin: false,
      selectedObjectIds: ['B'],
    });

    expect(filtered).toBe(scene);
  });

  it('keeps only selected objects when Cut Selected Graphics is on', () => {
    const filtered = filterSceneForOutputScope(
      sceneWithObjects(['A', 'B', 'C']),
      selectedScope(['B']),
    );

    expect(filtered.objects.map((object) => object.id)).toEqual(['B']);
  });

  it('reports empty selection when Cut Selected Graphics is enabled with no selected ids', () => {
    expect(validateOutputScope(EMPTY_SCENE, selectedScope([]))).toEqual({
      ok: false,
      messages: [
        'Selected artwork only is enabled, but no artwork is selected. Select artwork or turn off Selected artwork only.',
      ],
    });
  });

  it('reports stale selection ids when selected objects no longer exist', () => {
    expect(validateOutputScope(sceneWithObjects(['A']), selectedScope(['missing']))).toEqual({
      ok: false,
      messages: [
        'Selected artwork only is enabled, but none of the selected artwork exists anymore. Select artwork or turn off Selected artwork only.',
      ],
    });
  });

  it('returns a scoped scene when selection is valid', () => {
    const result = validateOutputScope(sceneWithObjects(['A', 'B']), selectedScope(['B']));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.scene.objects.map((object) => object.id)).toEqual(['B']);
  });
});

function sceneWithObjects(ids: ReadonlyArray<string>): Scene {
  return {
    layers: [createLayer({ id: 'L1', color: '#ff0000' })],
    objects: ids.map((id, index) => object(id, index * 20)),
  };
}

function object(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}
