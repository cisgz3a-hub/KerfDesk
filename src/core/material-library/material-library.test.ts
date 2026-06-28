import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../scene';
import {
  applyMaterialRecipe,
  captureMaterialRecipe,
  isMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
  normalizeMaterialRecipe,
  type MaterialRecipe,
} from './material-library';

function makeLayer(patch: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'layer-1', color: '#112233' }),
    ...patch,
  };
}

describe('material library recipes', () => {
  it('captures backed cut settings without project/session layer fields', () => {
    const layer = makeLayer({
      id: 'layer-source',
      color: '#aabbcc',
      mode: 'fill',
      minPower: 8,
      power: 46,
      speed: 1800,
      passes: 3,
      airAssist: true,
      tabsEnabled: true,
      tabSizeMm: 1.5,
      tabsPerShape: 6,
      tabSkipInnerShapes: false,
      visible: false,
      output: false,
      hatchAngleDeg: 37,
      hatchSpacingMm: 0.08,
      fillOverscanMm: 2.5,
      fillStyle: 'offset',
      fillBidirectional: false,
      fillCrossHatch: true,
    });

    const recipe = captureMaterialRecipe(layer);
    const rawRecipe = recipe as Record<string, unknown>;

    expect(Object.keys(recipe).sort()).toEqual([...MATERIAL_RECIPE_FIELDS].sort());
    expect(rawRecipe.id).toBeUndefined();
    expect(rawRecipe.color).toBeUndefined();
    expect(rawRecipe.visible).toBeUndefined();
    expect(rawRecipe.output).toBeUndefined();
    expect(recipe).toMatchObject({
      mode: 'fill',
      minPower: 8,
      power: 46,
      speed: 1800,
      passes: 3,
      airAssist: true,
      tabsEnabled: true,
      tabSizeMm: 1.5,
      tabsPerShape: 6,
      tabSkipInnerShapes: false,
      hatchAngleDeg: 37,
      hatchSpacingMm: 0.08,
      fillOverscanMm: 2.5,
      fillStyle: 'offset',
      fillBidirectional: false,
      fillCrossHatch: true,
    });
  });

  it('captures image-mode recipe fields used by raster output', () => {
    const layer = makeLayer({
      mode: 'image',
      ditherAlgorithm: 'atkinson',
      linesPerMm: 14,
      negativeImage: true,
      passThrough: true,
      dotWidthCorrectionMm: 0.06,
    });

    expect(captureMaterialRecipe(layer)).toMatchObject({
      mode: 'image',
      ditherAlgorithm: 'atkinson',
      linesPerMm: 14,
      negativeImage: true,
      passThrough: true,
      dotWidthCorrectionMm: 0.06,
    });
  });

  it('applies recipe fields while preserving target layer identity and output toggles', () => {
    const target = makeLayer({
      id: 'target-layer',
      color: '#00ff00',
      visible: false,
      output: false,
      mode: 'line',
      power: 12,
      speed: 900,
    });
    const recipe: MaterialRecipe = {
      mode: 'image',
      minPower: 5,
      power: 60,
      speed: 2200,
      passes: 2,
      airAssist: true,
      tabsEnabled: false,
      tabSizeMm: 0.5,
      tabsPerShape: 4,
      tabSkipInnerShapes: true,
      hatchAngleDeg: 15,
      hatchSpacingMm: 0.12,
      fillOverscanMm: 1.5,
      fillStyle: 'offset',
      fillBidirectional: false,
      fillCrossHatch: true,
      ditherAlgorithm: 'jarvis',
      linesPerMm: 12,
      negativeImage: true,
      passThrough: false,
      dotWidthCorrectionMm: 0.04,
    };

    const updated = applyMaterialRecipe(target, recipe);

    expect(updated).toMatchObject(recipe);
    expect(updated.id).toBe('target-layer');
    expect(updated.color).toBe('#00ff00');
    expect(updated.visible).toBe(false);
    expect(updated.output).toBe(false);
  });

  it('returns a normalized layer patch without session fields', () => {
    const recipe = captureMaterialRecipe(
      makeLayer({
        id: 'source-layer',
        color: '#ffffff',
        minPower: 65,
        power: 30,
        visible: false,
        output: false,
      }),
    );
    const rawPatch = materialRecipePatch(recipe) as Record<string, unknown>;

    expect(rawPatch.minPower).toBe(30);
    expect(rawPatch.power).toBe(30);
    expect(rawPatch.id).toBeUndefined();
    expect(rawPatch.color).toBeUndefined();
    expect(rawPatch.visible).toBeUndefined();
    expect(rawPatch.output).toBeUndefined();
  });

  it('strips runtime extra fields from recipe patches before applying to layers', () => {
    const target = makeLayer({
      id: 'safe-target',
      color: '#123456',
      visible: true,
      output: true,
    });
    const unsafeRecipe = {
      ...captureMaterialRecipe(makeLayer({ power: 40 })),
      id: 'hijacked-id',
      color: '#ffffff',
      visible: false,
      output: false,
    } as MaterialRecipe;

    const rawPatch = materialRecipePatch(unsafeRecipe) as Record<string, unknown>;
    const updated = applyMaterialRecipe(target, unsafeRecipe);

    expect(rawPatch.id).toBeUndefined();
    expect(rawPatch.color).toBeUndefined();
    expect(rawPatch.visible).toBeUndefined();
    expect(rawPatch.output).toBeUndefined();
    expect(updated.id).toBe('safe-target');
    expect(updated.color).toBe('#123456');
    expect(updated.visible).toBe(true);
    expect(updated.output).toBe(true);
  });

  it('validates material recipes from unknown values', () => {
    const valid = captureMaterialRecipe(makeLayer({ mode: 'fill', minPower: 10, power: 35 }));

    expect(isMaterialRecipe(valid)).toBe(true);
    expect(isMaterialRecipe({ ...valid, fillStyle: 'island' })).toBe(true);
    expect(isMaterialRecipe({ ...valid, fillStyle: 'auto' })).toBe(false);
    expect(isMaterialRecipe({ ...valid, mode: 'offset-fill' })).toBe(false);
    expect(isMaterialRecipe({ ...valid, fillStyle: 'spiral' })).toBe(false);
    expect(isMaterialRecipe({ ...valid, ditherAlgorithm: 'magic' })).toBe(false);
    expect(isMaterialRecipe({ ...valid, speed: 0 })).toBe(false);
    expect(isMaterialRecipe({ ...valid, power: 101 })).toBe(false);
    expect(isMaterialRecipe({ ...valid, minPower: 36 })).toBe(false);
    expect(isMaterialRecipe({ ...valid, passes: 0 })).toBe(false);
    expect(isMaterialRecipe({ ...valid, airAssist: 'on' })).toBe(false);
    expect(isMaterialRecipe({ ...valid, linesPerMm: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('accepts older recipes without air assist and patches them as off', () => {
    const { airAssist: _airAssist, ...legacyRecipe } = captureMaterialRecipe(
      makeLayer({ airAssist: true, mode: 'fill' }),
    );

    expect(isMaterialRecipe(legacyRecipe)).toBe(true);
    expect(normalizeMaterialRecipe(legacyRecipe)).not.toHaveProperty('airAssist');
    expect(materialRecipePatch(legacyRecipe).airAssist).toBe(false);
  });

  it('defaults older recipes without kerf compensation to zero', () => {
    const { kerfOffsetMm: _kerfOffsetMm, ...legacyRecipe } = captureMaterialRecipe(
      makeLayer({ kerfOffsetMm: 0.2, mode: 'line' }),
    );

    expect(isMaterialRecipe(legacyRecipe)).toBe(true);
    expect(normalizeMaterialRecipe(legacyRecipe).kerfOffsetMm).toBe(0);
    expect(materialRecipePatch(legacyRecipe).kerfOffsetMm).toBe(0);
  });

  it('defaults older recipes without tabs / bridges to off', () => {
    const {
      tabsEnabled: _tabsEnabled,
      tabSizeMm: _tabSizeMm,
      tabsPerShape: _tabsPerShape,
      tabSkipInnerShapes: _tabSkipInnerShapes,
      ...legacyRecipe
    } = captureMaterialRecipe(
      makeLayer({ tabsEnabled: true, tabSizeMm: 2, tabsPerShape: 8, tabSkipInnerShapes: false }),
    );

    expect(isMaterialRecipe(legacyRecipe)).toBe(true);
    expect(materialRecipePatch(legacyRecipe)).toMatchObject({
      tabsEnabled: false,
      tabSizeMm: 0.5,
      tabsPerShape: 4,
      tabSkipInnerShapes: true,
    });
  });

  it('normalizes recipe numbers for safe assignment', () => {
    const recipe = captureMaterialRecipe(
      makeLayer({
        minPower: 80,
        power: 45,
        speed: -200,
        passes: 2.9,
        hatchSpacingMm: -0.1,
        fillOverscanMm: -1,
        linesPerMm: 0,
        dotWidthCorrectionMm: -0.03,
      }),
    );

    expect(normalizeMaterialRecipe(recipe)).toMatchObject({
      minPower: 45,
      power: 45,
      speed: 1,
      passes: 2,
      hatchSpacingMm: 0.001,
      fillOverscanMm: 0,
      linesPerMm: 0.001,
      dotWidthCorrectionMm: 0,
    });
  });
});
