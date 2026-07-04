import { describe, expect, it } from 'vitest';

import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import {
  rankMaterialRecipeCandidates,
  recipeConfidence,
  type MaterialRecipeCandidate,
} from './material-matching';

type TestMaterialRecipeCandidate = MaterialRecipeCandidate & {
  readonly laserTechnology?: 'diode' | 'co2' | 'fiber' | 'unknown';
  readonly wavelengthNm?: number;
};

function candidate(patch: Partial<TestMaterialRecipeCandidate> = {}): TestMaterialRecipeCandidate {
  return compactCandidate({
    ...patch,
    id: patch.id ?? 'generic',
    material: patch.material ?? 'Birch plywood',
    operation: patch.operation ?? 'engrave',
  });
}

function compactCandidate(
  value: Partial<TestMaterialRecipeCandidate>,
): TestMaterialRecipeCandidate {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as TestMaterialRecipeCandidate;
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

  it('matches diode head recipes by technology and wavelength before power-only recipes', () => {
    const ranked = rankMaterialRecipeCandidates(
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      [
        candidate({ id: 'generic' }),
        candidate({ id: 'power', opticalPowerW: 20 }),
        candidate({
          id: 'diode-blue-head',
          laserTechnology: 'diode',
          wavelengthNm: 450,
          opticalPowerW: 20,
        }),
      ],
      { material: 'Birch plywood', operation: 'engrave' },
    );

    expect(ranked.map((match) => match.candidate.id)).toEqual([
      'diode-blue-head',
      'power',
      'generic',
    ]);
    expect(ranked[0]?.scope).toBe('laser-head');
    expect(ranked[0]?.warnings).toContain(
      'Matched by laser head class. Run a material test before production.',
    );
  });

  it('filters incompatible laser head metadata before ranking recipes', () => {
    const ranked = rankMaterialRecipeCandidates(
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      [
        candidate({ id: 'co2', laserTechnology: 'co2', wavelengthNm: 10600 }),
        candidate({ id: 'near-ir-diode', laserTechnology: 'diode', wavelengthNm: 980 }),
        candidate({ id: 'blue-diode', laserTechnology: 'diode', wavelengthNm: 455 }),
      ],
      { material: 'Birch plywood', operation: 'engrave' },
    );

    expect(ranked.map((match) => match.candidate.id)).toEqual(['blue-diode']);
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
