import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { MaterialRecipe } from './material-library';
import { rankMaterialRecipesForProfile, type MaterialRecipeCandidate } from './recipe-matching';

const recipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 35,
  speed: 1400,
  passes: 1,
  airAssist: false,
  kerfOffsetMm: 0,
  tabsEnabled: false,
  tabSizeMm: 0.5,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'threshold',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

function candidate(
  id: string,
  patch: Partial<MaterialRecipeCandidate> = {},
): MaterialRecipeCandidate {
  return {
    id,
    materialName: 'Birch Ply',
    thicknessMm: 3,
    operation: 'cut',
    recipe,
    confidence: 'starter',
    ...patch,
  };
}

describe('material recipe matching', () => {
  it('ranks exact profile matches ahead of family, optical power, and generic recipes', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      profileId: 'shop-falcon',
      machineFamily: 'falcon',
      laserSubProfile: {
        model: '20W module',
        opticalPowerW: 20,
        focusMode: 'manual',
        airAssist: 'manual',
      },
    } as const;
    const ranked = rankMaterialRecipesForProfile(device, [
      candidate('generic'),
      candidate('power', { opticalPowerW: 20 }),
      candidate('family', { machineFamily: 'falcon' }),
      candidate('exact', { profileId: 'shop-falcon' }),
    ]);

    expect(ranked.map((item) => item.recipe.id)).toEqual(['exact', 'family', 'power', 'generic']);
    expect(ranked[0]?.matchLevel).toBe('exact-profile');
  });

  it('marks incompatible explicit profile recipes as unsupported instead of silently applying them', () => {
    const [match] = rankMaterialRecipesForProfile(DEFAULT_DEVICE_PROFILE, [
      candidate('wrong-profile', { profileId: 'other-machine', confidence: 'calibrated' }),
    ]);

    expect(match).toMatchObject({
      matchLevel: 'unsupported',
      warning: 'Recipe is calibrated for profile other-machine, not generic-grbl-400x400.',
    });
  });
});
