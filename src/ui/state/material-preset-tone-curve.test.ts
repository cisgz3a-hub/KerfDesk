import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import {
  applyMaterialRecipe,
  captureMaterialRecipe,
  type MaterialRecipe,
} from '../../core/material-library';
import { fitPhotoToneCurve, type PhotoToneCurve } from '../../core/raster/photo-tone-curve';
import { encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialPreset,
} from '../../io/material-library';
import { materialRecipeDifferences } from '../material-library/MaterialRecipePreview';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

// Rolling audit v4 H5-P2-2 (ADR-670 Amendment 2): a Material Library preset
// kept the operation's tone curve from another material, so a slate preset
// over a Birch-calibrated operation burned about 39% less than the preset.

const BIRCH: PhotoToneCurve = fitPhotoToneCurve(
  [10, 20, 30, 40, 50, 60, 70, 80, 90].map((commandedPercent) => ({
    commandedPercent,
    observedPercent: 100 * (1 - (1 - commandedPercent / 100) ** 2),
  })),
  'Birch Jarvis 254 DPI dark',
);

// The audit's slate photo preset: Stucki, 8 lines/mm, light marks, 70%.
const SLATE: MaterialRecipe = {
  ...captureMaterialRecipe(createLayer({ id: 'draft', color: '#000000', mode: 'image' })),
  ditherAlgorithm: 'stucki',
  linesPerMm: 8,
  negativeImage: true,
  power: 70,
  speed: 2000,
  passThrough: false,
};

function slatePreset(recipe: MaterialRecipe = SLATE): MaterialPreset {
  return {
    id: 'slate-photo',
    materialName: 'Slate',
    description: 'Photo on slate',
    recipe,
    revision: 'rev-1',
  };
}

function operation(): Layer {
  const { scene } = useStore.getState().project;
  const object = scene.objects.find((candidate) => candidate.id === 'O1');
  const found = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (found === null) throw new Error('expected artwork operation');
  return found;
}

function giveOperationTheBirchCurve(): void {
  const { project } = useStore.getState();
  const id = operation().id;
  useStore.getState().setProject({
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) =>
        layer.id === id ? { ...layer, ditherAlgorithm: 'jarvis', photoToneCurve: BIRCH } : layer,
      ),
    },
  });
}

describe('Material Library presets and the tone curve (ADR-670 Amendment 2)', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setMaterialLibrary({
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId: 'shop-library',
      name: 'Shop Library',
      entries: [slatePreset()],
    });
    giveOperationTheBirchCurve();
  });

  it('Assign removes the curve measured for another material', () => {
    expect(useStore.getState().assignMaterialPresetToLayer(operation().id, 'slate-photo')).toBe(
      true,
    );

    expect(operation().ditherAlgorithm).toBe('stucki');
    expect(operation().photoToneCurve).toBeUndefined();
  });

  it('Link removes the curve and does not record it in the link snapshot', () => {
    expect(useStore.getState().linkMaterialPresetToLayer(operation().id, 'slate-photo')).toBe(true);

    expect(operation().photoToneCurve).toBeUndefined();
    expect(operation().materialBinding?.lastResolved.photoToneCurve).toBeUndefined();
  });

  it('Assign still removes the curve when every recipe setting already matches', () => {
    useStore.getState().assignMaterialPresetToLayer(operation().id, 'slate-photo');
    giveOperationTheBirchCurve();
    useStore.getState().setLayerParam(operation().id, { ditherAlgorithm: 'stucki' });

    expect(useStore.getState().assignMaterialPresetToLayer(operation().id, 'slate-photo')).toBe(
      true,
    );
    expect(operation().photoToneCurve).toBeUndefined();
  });

  it('lists the curve among the settings the preset changes', () => {
    expect(materialRecipeDifferences(operation(), slatePreset())).toContainEqual({
      setting: 'Tone calibration',
      before: 'Birch Jarvis 254 DPI dark',
      after: 'None',
    });
  });

  it('burns a photo exactly as the preset alone does', () => {
    const width = 64;
    const height = 8;
    const luma = new Uint8Array(width * height);
    for (let i = 0; i < luma.length; i += 1)
      luma[i] = Math.round(((i % width) / (width - 1)) * 255);
    const ramp: RasterImage = {
      kind: 'raster-image',
      id: 'ramp',
      source: 'ramp.png',
      dataUrl: 'data:image/png;base64,ramp',
      lumaBase64: encodeCanonicalBase64(luma),
      pixelWidth: width,
      pixelHeight: height,
      bounds: { minX: 0, minY: 0, maxX: 32, maxY: 4 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      operationIds: ['photo-op'],
      dither: 'jarvis',
      linesPerMm: 8,
    };
    const base = { ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }) };
    const totalS = (layer: Layer): number =>
      compileRasterGroupsForLayer([ramp], layer, DEFAULT_DEVICE_PROFILE)
        .groups.flatMap((group) => [...group.sValues])
        .reduce((sum, s) => sum + s, 0);

    const assigned = applyMaterialRecipe({ ...base, photoToneCurve: BIRCH }, SLATE);
    const presetAlone = applyMaterialRecipe(base, SLATE);

    expect(totalS(presetAlone)).toBeGreaterThan(0);
    expect(totalS(assigned)).toBe(totalS(presetAlone));
  });
});
