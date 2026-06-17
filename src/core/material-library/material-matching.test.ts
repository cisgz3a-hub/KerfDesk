import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
} from '../devices';
import {
  rankMaterialRecipeCandidates,
  recipeConfidence,
  type MaterialRecipeCandidate,
} from './material-matching';

function candidate(patch: Partial<MaterialRecipeCandidate> = {}): MaterialRecipeCandidate {
  return {
    id: patch.id ?? 'generic',
    material: patch.material ?? 'Birch plywood',
    operation: patch.operation ?? 'engrave',
    ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
    ...(patch.warning !== undefined ? { warning: patch.warning } : {}),
    ...(patch.profileId !== undefined ? { profileId: patch.profileId } : {}),
    ...(patch.machineFamily !== undefined ? { machineFamily: patch.machineFamily } : {}),
    ...(patch.laserModel !== undefined ? { laserModel: patch.laserModel } : {}),
    ...(patch.opticalPowerW !== undefined ? { opticalPowerW: patch.opticalPowerW } : {}),
    ...(patch.thicknessMm !== undefined ? { thicknessMm: patch.thicknessMm } : {}),
  };
}

describe('material recipe profile matching', () => {
  it('ranks exact profile before machine family, laser model, optical power, then generic', () => {
    const ranked = rankMaterialRecipeCandidates(
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      [
        candidate({ id: 'generic' }),
        candidate({ id: 'power', opticalPowerW: 20 }),
        candidate({ id: 'laser', laserModel: 'LASER TREE LT-4LDS-V2' }),
        candidate({ id: 'family', machineFamily: 'neotronics-4040-max' }),
        candidate({ id: 'profile', profileId: 'neotronics-4040-max-lt4lds-v2-20w' }),
      ],
      { material: 'Birch plywood', operation: 'engrave' },
    );

    expect(ranked.map((match) => match.candidate.id)).toEqual([
      'profile',
      'family',
      'laser',
      'power',
      'generic',
    ]);
  });

  it('filters material, operation, and thickness mismatches before ranking', () => {
    const ranked = rankMaterialRecipeCandidates(
      DEFAULT_DEVICE_PROFILE,
      [
        candidate({ id: 'material-miss', material: 'Acrylic' }),
        candidate({ id: 'operation-miss', operation: 'cut' }),
        candidate({ id: 'thickness-miss', thicknessMm: 6 }),
        candidate({ id: 'match', thicknessMm: 3 }),
      ],
      { material: 'Birch plywood', operation: 'engrave', thicknessMm: 3 },
    );

    expect(ranked.map((match) => match.candidate.id)).toEqual(['match']);
  });

  it('surfaces confidence and warning text without treating unsupported recipes as safe matches', () => {
    const ranked = rankMaterialRecipeCandidates(DEFAULT_DEVICE_PROFILE, [
      candidate({ id: 'starter' }),
      candidate({
        id: 'unsupported',
        confidence: 'unsupported',
        warning: 'Clear acrylic is not supported on this diode profile.',
      }),
    ]);

    expect(recipeConfidence(candidate({}))).toBe('starter');
    expect(ranked.map((match) => match.candidate.id)).toEqual(['starter', 'unsupported']);
    expect(ranked[1]?.warnings).toContain('Unsupported recipe.');
    expect(ranked[1]?.warnings).toContain('Clear acrylic is not supported on this diode profile.');
  });
});
