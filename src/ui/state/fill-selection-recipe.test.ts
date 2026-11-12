// Tools audit T1, T06: Fill Selection must switch a linked cut to the Fill
// recipe as the inspector does (ADR-496 §6), and a selection separated from a
// tuned Fill keeps that Fill's settings.
import { beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  type Layer,
  type LayerMode,
  type ShapeObject,
} from '../../core/scene';
import type { ProjectLaserMaterial } from '../../core/scene/project';
import { createRectangle } from '../../core/shapes/primitives';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function preset(id: string, mode: LayerMode, settings: Partial<Layer>, extra = {}): MaterialPreset {
  return {
    id,
    materialName: 'Birch plywood',
    thicknessMm: 3,
    description: id,
    recipe: captureMaterialRecipe({ ...createLayer({ id, color: '#000000', mode }), ...settings }),
    revision: 'rev-1',
    ...extra,
  };
}

const LIBRARY: MaterialLibraryDocument = {
  format: MATERIAL_LIBRARY_FORMAT,
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'shop',
  name: 'Shop',
  entries: [
    preset('birch-3-cut', 'line', { power: 90, speed: 400, passes: 2 }, { operation: 'cut' }),
    preset('birch-3-engrave', 'fill', { power: 35, speed: 3000 }, { operation: 'engrave' }),
  ],
};

const BIRCH_3: ProjectLaserMaterial = {
  name: 'Birch plywood',
  thicknessMm: 3,
  autoApplyRecipes: true,
};

function drawAndSelectRectangle(id = 'rect'): Layer {
  useStore.getState().drawShape(
    createRectangle({
      id,
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
  useStore.setState({ selectedObjectId: id, additionalSelectedIds: new Set() });
  return operationOf(id);
}

function operationOf(objectId: string): Layer {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error(`no operation for ${objectId}`);
  return operation;
}

function square(id: string, color: string): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

describe('Fill Selection takes the Fill recipe (T06-P1-1)', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().setMaterialLibrary(LIBRARY);
  });

  it('switches a drawn shape linked to the cut recipe to the engrave recipe', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    expect(drawAndSelectRectangle()).toMatchObject({
      mode: 'line',
      power: 90,
      materialBinding: { presetId: 'birch-3-cut' },
    });

    useStore.getState().fillSelectionSeparately();

    expect(operationOf('rect')).toMatchObject({
      mode: 'fill',
      power: 35,
      speed: 3000,
      passes: 1,
      materialBinding: { presetId: 'birch-3-engrave' },
    });
    expect(useStore.getState().undoStack.length).toBeGreaterThan(0);
  });

  it('gives what the inspector Fill switch gives on the same shape', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const layer = drawAndSelectRectangle();
    useStore.getState().setLayerParam(layer.id, { mode: 'fill' });
    const inspector = operationOf('rect');
    useStore.getState().undo();

    useStore.getState().fillSelectionSeparately();

    expect(operationOf('rect')).toEqual(inspector);
  });

  it('keeps an edited cut operation’s own settings, as a mode switch does', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const layer = drawAndSelectRectangle();
    useStore.getState().setLayerParam(layer.id, { power: 70 });

    useStore.getState().fillSelectionSeparately();

    expect(operationOf('rect')).toMatchObject({ mode: 'fill', power: 70, speed: 400 });
  });
});

describe('Fill Selection keeps a tuned Fill (T06-P2-1)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('separates one of two artworks sharing a Fill with that Fill’s settings', () => {
    const tuned: Layer = {
      ...createLayer({ id: 'scan', color: '#ff0000', mode: 'fill' }),
      power: 25,
      speed: 3000,
      hatchSpacingMm: 0.2,
      hatchAngleDeg: 45,
    };
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          objects: [square('a', '#ff0000'), square('b', '#ff0000')],
          layers: [tuned],
          groups: [],
        },
      },
      selectedObjectId: 'a',
      additionalSelectedIds: new Set(),
    });

    useStore.getState().fillSelectionSeparately();

    const separated = operationOf('a');
    expect(separated.id).not.toBe('scan');
    expect(separated.color).not.toBe('#ff0000');
    expect(separated).toMatchObject({
      mode: 'fill',
      power: 25,
      speed: 3000,
      hatchSpacingMm: 0.2,
      hatchAngleDeg: 45,
    });
    expect(operationOf('b')).toEqual(tuned);
  });
});
