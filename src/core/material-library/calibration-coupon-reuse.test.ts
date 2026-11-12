// Tools audit T1, T04-P2-1 and T04R-P3-1: settings taken from a Scan Offset
// Test coupon swatch must not carry the coupon's calibration marker, explicit
// 0 mm offset or uncalibrated-scan switch onto ordinary artwork, or a
// require-verified profile would run that artwork two-way, uncorrected.
import { describe, expect, it } from 'vitest';
import {
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../devices/device-profile';
import { generateScanOffsetCalibrationPattern } from '../job/scan-offset-calibration-pattern';
import { resolveFillScanDirection } from '../job/scan-direction-policy';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../scene';
import {
  applyLayerDefaultSettings,
  captureLayerDefaultSettings,
} from '../../ui/layers/layer-default-settings';
import { layerSettingsForPaste, layerSettingsFrom } from '../../ui/state/layer-settings-clipboard';
import { parseProcessRecipes } from '../../io/material-library/process-recipe-io';
import { applyProcessRecipe } from './apply-process-recipe';
import { captureProcessRecipe } from './capture-process-recipe';
import { applyMaterialRecipe, captureMaterialRecipe } from './material-library';
import type { ProcessRecipe } from './process-recipe';
import { templateOperation } from './process-recipe-operation';

const TABLE = [
  { speedMmPerMin: 1000, offsetMm: -0.2 },
  { speedMmPerMin: 5000, offsetMm: -0.4 },
];
const PENDING: DeviceProfile = {
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  scanningOffsets: TABLE,
  scanOffsetCalibrationStatus: 'pending',
};
const VERIFIED: DeviceProfile = { ...PENDING, scanOffsetCalibrationStatus: 'verified' };
const UNCALIBRATED: DeviceProfile = {
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  scanningOffsets: [],
  scanOffsetCalibrationStatus: undefined,
};

const art = {
  kind: 'imported-svg',
  id: 'art',
  source: 'art.svg',
  operationIds: ['job'],
  bounds: { minX: 0, minY: 0, maxX: 30, maxY: 5 },
  transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 5 },
            { x: 0, y: 5 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
} as unknown as ImportedSvg;

function ordinaryLayer(): Layer {
  return {
    ...createLayer({ id: 'job', name: 'Birch fill', color: '#ff0000', mode: 'fill' }),
    speed: 3000,
    power: 30,
    hatchAngleDeg: 0,
    hatchSpacingMm: 0.1,
    fillStyle: 'scanline',
    fillBidirectional: true,
    fillCrossHatch: false,
    fillOverscanMm: 5,
  };
}

function withScene(device: DeviceProfile, scene: Partial<Project['scene']>): Project {
  const base = createProject(device);
  return { ...base, device, scene: { ...base.scene, ...scene } };
}

function coupon(mode: 'baseline' | 'verification', device: DeviceProfile) {
  const pattern = generateScanOffsetCalibrationPattern(
    {
      mode,
      steps: 3,
      speedMin: 1000,
      speedMax: 5000,
      power: 12,
      swatchWidthMm: 30,
      swatchHeightMm: 5,
    },
    device,
  );
  const cell = pattern.cells[1];
  if (cell === undefined) throw new Error('coupon cell missing');
  const layer = pattern.scene.layers.find((candidate) => candidate.id === cell.layerId);
  if (layer === undefined) throw new Error('coupon layer missing');
  return { project: withScene(device, pattern.scene), objectId: cell.objectId, layer };
}

function recipeFrom(mode: 'baseline' | 'verification', device: DeviceProfile): ProcessRecipe {
  const source = coupon(mode, device);
  const captured = captureProcessRecipe(source.project, source.objectId, {
    id: 'p1',
    name: 'My fill',
    description: '',
    revision: '1',
  });
  if (captured.kind !== 'ok') throw new Error(captured.reason);
  // Through the library file, as a saved recipe is used.
  const reread = parseProcessRecipes(JSON.parse(JSON.stringify([captured.value])));
  if (reread.kind !== 'ok') throw new Error(reread.reason);
  const recipe = reread.value[0];
  if (recipe === undefined) throw new Error('recipe missing');
  return recipe;
}

function applyToArt(device: DeviceProfile, recipe: ProcessRecipe): Layer {
  const applied = applyProcessRecipe(
    withScene(device, { objects: [art], layers: [ordinaryLayer()] }),
    ['art'],
    recipe,
  );
  if (applied.kind !== 'ok') throw new Error(applied.reason);
  const target = applied.value.scene.objects[0] as ImportedSvg;
  const layer = applied.value.scene.layers.find((candidate) =>
    (target.operationIds ?? []).includes(candidate.id),
  );
  if (layer === undefined) throw new Error('applied operation missing');
  return layer;
}

describe('settings reused from a Scan Offset Test coupon (T04-P2-1)', () => {
  it('the coupon swatch itself still burns two-way at 0 mm on a pending profile', () => {
    const { layer } = coupon('baseline', PENDING);
    expect(resolveFillScanDirection(PENDING, layer).reason).toBe('calibration-baseline');
  });

  it.each(['baseline', 'verification'] as const)(
    'a recipe saved from a %s swatch keeps the one-way fallback on a pending profile',
    (mode) => {
      const recipe = recipeFrom(mode, PENDING);
      expect(recipe.steps[0]).not.toHaveProperty('scanOffsetCalibrationMode');
      const layer = applyToArt(PENDING, recipe);
      expect(layer.scanOffsetCalibrationMode).toBeUndefined();
      expect(resolveFillScanDirection(PENDING, layer)).toEqual({
        bidirectional: false,
        reason: 'pending-calibration-profile-fallback',
      });
    },
  );

  it('a recipe from a baseline swatch uses the verified offset table, not the coupon 0 mm', () => {
    const layer = applyToArt(VERIFIED, recipeFrom('baseline', VERIFIED));
    expect(layer.bidirectionalScanOffsetMm).toBeUndefined();
    expect(layer.allowUncalibratedBidirectionalScan).not.toBe(true);
    expect(resolveFillScanDirection(VERIFIED, layer).reason).toBe('calibrated-bidirectional');
  });

  it('an older saved recipe that still carries the marker is applied without it', () => {
    const recipe = recipeFrom('baseline', PENDING);
    const step = recipe.steps[0];
    if (step === undefined) throw new Error('step missing');
    const legacy: ProcessRecipe = {
      ...recipe,
      steps: [
        {
          ...step,
          scanOffsetCalibrationMode: 'baseline',
          settings: {
            ...step.settings,
            allowUncalibratedBidirectionalScan: true,
            bidirectionalScanOffsetMm: 0,
          },
        },
      ],
    };
    const layer = applyToArt(UNCALIBRATED, legacy);
    expect(layer.scanOffsetCalibrationMode).toBeUndefined();
    expect(resolveFillScanDirection(UNCALIBRATED, layer)).toEqual({
      bidirectional: false,
      reason: 'uncalibrated-profile-fallback',
    });
    const templated = templateOperation(
      { objects: [art], layers: [] } as never,
      art,
      legacy.steps[0]!,
    );
    expect(templated.scanOffsetCalibrationMode).toBeUndefined();
    expect(templated.allowUncalibratedBidirectionalScan).not.toBe(true);
  });

  it('re-applying a template over a coupon operation does not keep its overrides', () => {
    const { layer: couponLayer } = coupon('baseline', UNCALIBRATED);
    const step = { ...recipeFrom('baseline', UNCALIBRATED).steps[0]! };
    const templated = templateOperation(
      { objects: [art], layers: [couponLayer] } as never,
      art,
      step,
      couponLayer,
    );
    expect(templated.scanOffsetCalibrationMode).toBeUndefined();
    expect(resolveFillScanDirection(UNCALIBRATED, templated).bidirectional).toBe(false);
  });
});

describe('other reuse of coupon settings (T04R-P3-1)', () => {
  it.each([
    [
      'Make Default',
      (source: Layer) =>
        applyLayerDefaultSettings(ordinaryLayer(), captureLayerDefaultSettings(source)),
    ],
    [
      'Copy and Paste settings',
      (source: Layer) => {
        const target = ordinaryLayer();
        return { ...target, ...layerSettingsForPaste(target, layerSettingsFrom(source)) };
      },
    ],
    [
      'a material preset',
      (source: Layer) => applyMaterialRecipe(ordinaryLayer(), captureMaterialRecipe(source)),
    ],
  ])('%s keeps an uncalibrated profile one-way', (_label, reuse) => {
    const { layer: couponLayer } = coupon('baseline', UNCALIBRATED);
    const layer = reuse(couponLayer);
    expect(layer.scanOffsetCalibrationMode).toBeUndefined();
    expect(layer.bidirectionalScanOffsetMm).toBeUndefined();
    expect(resolveFillScanDirection(UNCALIBRATED, layer)).toEqual({
      bidirectional: false,
      reason: 'uncalibrated-profile-fallback',
    });
  });

  it('an ordinary layer still carries its own expert switch and local offset', () => {
    const source: Layer = {
      ...ordinaryLayer(),
      allowUncalibratedBidirectionalScan: true,
      bidirectionalScanOffsetMm: -0.25,
    };
    for (const layer of [
      applyLayerDefaultSettings(ordinaryLayer(), captureLayerDefaultSettings(source)),
      applyMaterialRecipe(ordinaryLayer(), captureMaterialRecipe(source)),
    ]) {
      expect(layer.allowUncalibratedBidirectionalScan).toBe(true);
      expect(layer.bidirectionalScanOffsetMm).toBe(-0.25);
    }
  });
});
