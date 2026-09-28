import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, type LayerMode } from '../scene';
import {
  bestRecipeForOperation,
  jobMaterialChoices,
  type AutoRecipeCandidate,
} from './auto-recipe';
import { captureMaterialRecipe } from './material-library';

const DEVICE = { ...DEFAULT_DEVICE_PROFILE, profileId: 'falcon-a1-pro', machineFamily: 'falcon' };

function candidate(
  id: string,
  mode: LayerMode,
  extra: Partial<AutoRecipeCandidate> = {},
): AutoRecipeCandidate {
  return {
    id,
    materialName: 'Birch plywood',
    recipe: captureMaterialRecipe(createLayer({ id, color: '#000000', mode })),
    ...extra,
  };
}

const birch3Cut = candidate('birch-3-cut', 'line', { thicknessMm: 3, operation: 'cut' });
const birch6Cut = candidate('birch-6-cut', 'line', { thicknessMm: 6, operation: 'cut' });
const birch3Engrave = candidate('birch-3-engrave', 'fill', {
  thicknessMm: 3,
  operation: 'engrave',
});
const birchPhoto = candidate('birch-photo', 'image', { thicknessMm: 3, operation: 'image' });

describe('the best recipe for a new operation (ADR-496)', () => {
  it('takes the recipe for the job material, thickness and mode', () => {
    const all = [birch6Cut, birch3Engrave, birch3Cut, birchPhoto];
    const pick = (mode: LayerMode) =>
      bestRecipeForOperation(DEVICE, all, { name: 'Birch plywood', thicknessMm: 3 }, mode)
        ?.candidate.id;
    expect(pick('line')).toBe('birch-3-cut');
    expect(pick('fill')).toBe('birch-3-engrave');
    expect(pick('image')).toBe('birch-photo');
  });

  it('never gives a cut a recipe for another thickness', () => {
    expect(
      bestRecipeForOperation(
        DEVICE,
        [birch6Cut],
        { name: 'birch plywood', thicknessMm: 3 },
        'line',
      ),
    ).toBeUndefined();
    expect(
      bestRecipeForOperation(DEVICE, [birch6Cut], { name: 'Birch plywood' }, 'line'),
    ).toBeUndefined();
    const anyThickness = candidate('birch-any-cut', 'line', { operation: 'cut' });
    expect(
      bestRecipeForOperation(DEVICE, [birch6Cut, anyThickness], { name: 'Birch plywood' }, 'line')
        ?.candidate.id,
    ).toBe('birch-any-cut');
  });

  it('lets an engraving take another thickness when none matches', () => {
    expect(
      bestRecipeForOperation(
        DEVICE,
        [birch3Engrave],
        { name: 'Birch plywood', thicknessMm: 6 },
        'fill',
      )?.candidate.id,
    ).toBe('birch-3-engrave');
  });

  it('never changes the operation mode or the material', () => {
    const acrylic = candidate('acrylic-cut', 'line', { materialName: 'Acrylic', operation: 'cut' });
    expect(
      bestRecipeForOperation(DEVICE, [birch3Cut, acrylic], { name: 'Acrylic' }, 'fill'),
    ).toBeUndefined();
    expect(bestRecipeForOperation(DEVICE, [birch3Cut], { name: '  ' }, 'line')).toBeUndefined();
  });

  it("prefers this machine's recipe, then calibrated over starter", () => {
    const generic = candidate('generic', 'line', { thicknessMm: 3, confidence: 'calibrated' });
    const family = candidate('family', 'line', { thicknessMm: 3, machineFamily: 'falcon' });
    const profile = candidate('profile', 'line', { thicknessMm: 3, profileId: 'falcon-a1-pro' });
    const otherMachine = candidate('other', 'line', { thicknessMm: 3, profileId: 'xtool-s1' });
    const material = { name: 'Birch plywood', thicknessMm: 3 };
    expect(
      bestRecipeForOperation(DEVICE, [generic, family, profile, otherMachine], material, 'line')
        ?.candidate.id,
    ).toBe('profile');
    const starter = candidate('starter', 'line', { thicknessMm: 3, confidence: 'starter' });
    expect(bestRecipeForOperation(DEVICE, [starter, generic], material, 'line')?.candidate.id).toBe(
      'generic',
    );
    expect(bestRecipeForOperation(DEVICE, [otherMachine], material, 'line')).toBeUndefined();
  });

  it('prefers a cut over a score for a Line, and skips unsupported recipes', () => {
    const score = candidate('score', 'line', { thicknessMm: 3, operation: 'score' });
    const unsupported = candidate('bad', 'line', { thicknessMm: 3, confidence: 'unsupported' });
    const material = { name: 'Birch plywood', thicknessMm: 3 };
    expect(bestRecipeForOperation(DEVICE, [score, birch3Cut], material, 'line')?.candidate.id).toBe(
      'birch-3-cut',
    );
    expect(bestRecipeForOperation(DEVICE, [score], material, 'line')?.candidate.id).toBe('score');
    expect(bestRecipeForOperation(DEVICE, [unsupported], material, 'line')).toBeUndefined();
  });
});

describe('job material choices (ADR-496)', () => {
  it('lists each material once with its thicknesses', () => {
    const acrylic = candidate('acrylic', 'line', { materialName: 'Acrylic', thicknessMm: 5 });
    expect(jobMaterialChoices([birch6Cut, acrylic, birch3Cut, birch3Engrave])).toEqual([
      { name: 'Acrylic', thicknessesMm: [5] },
      { name: 'Birch plywood', thicknessesMm: [3, 6] },
    ]);
  });
});
