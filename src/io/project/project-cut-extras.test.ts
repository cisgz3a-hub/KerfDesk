import { describe, expect, it } from 'vitest';
import {
  capturedRecipe,
  recipeProject,
} from '../../core/material-library/process-recipe.test-fixture';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  type Layer,
  type Project,
} from '../../core/scene';
import {
  deserializeMaterialLibrary,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from '../material-library/material-library-io';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const EXTRAS = {
  perforationEnabled: true,
  perforationCutMm: 4,
  perforationSkipMm: 0.5,
  overcutMm: 1.5,
  imageOverscanMm: 9,
} as const;

function projectWith(settings: Partial<Layer>): Project {
  const layer: Layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), ...settings };
  return {
    ...createProject(),
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg',
          id: 'O1',
          source: 'o1.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          operationIds: ['L1'],
          operationOverride: { byOperation: { L1: { overcutMm: 3, perforationEnabled: false } } },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('ADR-415 settings in project files', () => {
  it('round-trips perforation, overcut and image overscan on operations and overrides', () => {
    const project = projectWith(EXTRAS);
    const loaded = deserializeProject(serializeProject(project));
    if (loaded.kind !== 'ok') throw new Error(`Expected load, got ${loaded.kind}`);
    expect(loaded.project.scene.layers[0]).toMatchObject(EXTRAS);
    expect(loaded.project.scene.objects[0]?.operationOverride).toEqual({
      byOperation: { L1: { overcutMm: 3, perforationEnabled: false } },
    });
  });

  it.each([
    { overcutMm: -1 },
    { perforationCutMm: 0 },
    { perforationSkipMm: -0.5 },
    { imageOverscanMm: -5 },
    { perforationEnabled: 'yes' },
  ])('rejects an invalid stored value (%o)', (bad) => {
    const raw = JSON.parse(serializeProject(projectWith({}))) as {
      scene: { layers: Array<Record<string, unknown>> };
    };
    raw.scene.layers[0] = { ...raw.scene.layers[0], ...bad };
    expect(deserializeProject(JSON.stringify(raw)).kind).toBe('invalid');
  });

  it('opens a schema 9 project unchanged, with nothing turned on', () => {
    const raw = JSON.parse(serializeProject(projectWith({}))) as Record<string, unknown>;
    const loaded = deserializeProject(JSON.stringify({ ...raw, schemaVersion: 9 }));
    if (loaded.kind !== 'ok') throw new Error(`Expected load, got ${loaded.kind}`);
    expect(loaded.migratedFrom).toBe(9);
    expect(loaded.project.scene.layers[0]).not.toHaveProperty('perforationEnabled');
    expect(loaded.project.scene.layers[0]).not.toHaveProperty('overcutMm');
  });

  it('captures the settings only when an operation sets them, so older recipes still match', () => {
    const plain = captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'line' });
    expect(Object.keys(plain)).not.toContain('perforationEnabled');
    expect(captureLayerOperationSettings({ ...LAYER_DEFAULTS, ...EXTRAS })).toMatchObject(EXTRAS);
  });

  it('round-trips a process recipe whose step perforates', () => {
    const source = recipeProject();
    const project: Project = {
      ...source,
      scene: {
        ...source.scene,
        layers: source.scene.layers.map((layer) =>
          layer.mode === 'line' ? { ...layer, ...EXTRAS } : layer,
        ),
      },
    };
    const document: MaterialLibraryDocument = {
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId: 'recipes',
      name: 'Recipes',
      entries: [],
      processRecipes: [capturedRecipe(project)],
    };
    expect(
      document.processRecipes?.[0]?.steps.some((step) => step.settings.perforationEnabled === true),
    ).toBe(true);
    expect(deserializeMaterialLibrary(serializeMaterialLibrary(document))).toEqual({
      kind: 'ok',
      library: document,
    });
  });
});
