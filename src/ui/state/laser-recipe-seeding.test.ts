import { beforeEach, describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  type Layer,
  type LayerMode,
  type RasterImage,
} from '../../core/scene';
import type { ProjectLaserMaterial } from '../../core/scene/project';
import { createRectangle } from '../../core/shapes/primitives';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';
import { deserializeProject, serializeProject } from '../../io/project';
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
    preset('birch-photo', 'image', { power: 25, speed: 2500 }, { operation: 'image' }),
  ],
};

const BIRCH_3: ProjectLaserMaterial = {
  name: 'Birch plywood',
  thicknessMm: 3,
  autoApplyRecipes: true,
};

function drawRectangle(id = 'rect', color = '#0000ff'): Layer {
  useStore.getState().drawShape(
    createRectangle({
      id,
      color,
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
  return operationOf(id);
}

function operationOf(objectId: string): Layer {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error(`no operation for ${objectId}`);
  return operation;
}

describe('recipes that apply themselves (ADR-496)', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().setMaterialLibrary(LIBRARY);
  });

  it('leaves new operations alone until the job has a material', () => {
    const layer = drawRectangle();
    expect(layer.materialBinding).toBeUndefined();
    expect(layer.power).toBe(createLayer({ id: 'x', color: '#000000' }).power);
  });

  it('links the best recipe to a new operation', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const layer = drawRectangle();
    expect(layer).toMatchObject({ mode: 'line', power: 90, speed: 400, passes: 2 });
    expect(layer.materialBinding).toMatchObject({
      libraryId: 'shop',
      presetId: 'birch-3-cut',
      presetRevision: 'rev-1',
    });
  });

  it('keeps settings when the switch is off or no recipe fits', () => {
    useStore.getState().setJobLaserMaterial({ ...BIRCH_3, autoApplyRecipes: false });
    expect(drawRectangle('a', '#0000ff').materialBinding).toBeUndefined();
    useStore.getState().setJobLaserMaterial({ ...BIRCH_3, thicknessMm: 6 });
    expect(drawRectangle('b', '#00ff00').materialBinding).toBeUndefined();
  });

  it('gives a new image its image recipe', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    useStore.getState().importRasterImage(IMAGE);
    expect(operationOf('photo')).toMatchObject({
      mode: 'image',
      power: 25,
      materialBinding: { presetId: 'birch-photo' },
    });
  });

  it('switches an untouched operation to the new mode’s recipe', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const layer = drawRectangle();
    useStore.getState().setLayerParam(layer.id, { mode: 'fill' });
    expect(operationOf('rect')).toMatchObject({
      mode: 'fill',
      power: 35,
      speed: 3000,
      materialBinding: { presetId: 'birch-3-engrave' },
    });
  });

  it('keeps an edited operation’s settings when its mode is switched', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const layer = drawRectangle();
    useStore.getState().setLayerParam(layer.id, { power: 70 });
    useStore.getState().setLayerParam(layer.id, { mode: 'fill' });
    expect(operationOf('rect')).toMatchObject({ mode: 'fill', power: 70, speed: 400 });
  });

  it('applies the best recipes to every operation as one undo step', () => {
    drawRectangle('a', '#0000ff');
    drawRectangle('b', '#ff0000');
    const blue = operationOf('a');
    useStore.getState().setLayerParam(blue.id, { mode: 'fill' });
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const undoDepth = useStore.getState().undoStack.length;

    const result = useStore.getState().applyBestRecipesToOperations();

    expect(result).toEqual({ applied: 2, alreadyCurrent: 0, unmatched: [] });
    expect(operationOf('a').materialBinding?.presetId).toBe('birch-3-engrave');
    expect(operationOf('b').materialBinding?.presetId).toBe('birch-3-cut');
    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
    expect(useStore.getState().applyBestRecipesToOperations()).toEqual({
      applied: 0,
      alreadyCurrent: 2,
      unmatched: [],
    });
    useStore.getState().undo();
    expect(operationOf('a').materialBinding).toBeUndefined();
  });

  it('names the operations with no recipe', () => {
    drawRectangle();
    useStore.getState().setJobLaserMaterial({ ...BIRCH_3, thicknessMm: 6 });
    const name = operationOf('rect').name;
    expect(useStore.getState().applyBestRecipesToOperations()).toEqual({
      applied: 0,
      alreadyCurrent: 0,
      unmatched: [name],
    });
  });

  it('keeps the job material in the project file and in undo', () => {
    useStore.getState().setJobLaserMaterial(BIRCH_3);
    const project = useStore.getState().project;
    expect(project.jobSetup.laserMaterial).toEqual(BIRCH_3);
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.kind === 'ok' ? loaded.project.jobSetup.laserMaterial : null).toEqual(BIRCH_3);

    useStore.getState().setJobLaserMaterial(undefined);
    expect(useStore.getState().project.jobSetup.laserMaterial).toBeUndefined();
    useStore.getState().undo();
    expect(useStore.getState().project.jobSetup.laserMaterial).toEqual(BIRCH_3);
  });

  it('refuses a malformed job material in a project file', () => {
    const raw = JSON.parse(serializeProject(useStore.getState().project)) as {
      jobSetup: Record<string, unknown>;
    };
    raw.jobSetup['laserMaterial'] = { name: '', autoApplyRecipes: true };
    expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
    raw.jobSetup['laserMaterial'] = { name: 'Birch', thicknessMm: -1, autoApplyRecipes: true };
    expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
  });
});

const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
  lumaBase64: 'AP//AA==',
};
