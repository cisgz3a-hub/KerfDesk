import { describe, expect, it } from 'vitest';
import type { MaterialRecipe } from '../../../core/material-library';
import {
  EMPTY_IDENTITY,
  identityComplete,
  initialWizardState,
  nextStep,
  previousStep,
  stepHeading,
  stepNumber,
  wizardReducer,
  type IdentityDraft,
  type WizardState,
} from './wizard-state';

const recipe: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 30,
  speed: 1500,
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
  fillStyle: 'scanline',
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'floyd-steinberg',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

function state(): WizardState {
  return initialWizardState({ identity: EMPTY_IDENTITY, recipe });
}

describe('wizard step navigation', () => {
  it('walks forward identity -> settings -> details -> review and stops', () => {
    expect(nextStep('identity')).toBe('settings');
    expect(nextStep('settings')).toBe('details');
    expect(nextStep('details')).toBe('review');
    expect(nextStep('review')).toBe('review');
  });

  it('walks back and stops at identity', () => {
    expect(previousStep('review')).toBe('details');
    expect(previousStep('details')).toBe('settings');
    expect(previousStep('settings')).toBe('identity');
    expect(previousStep('identity')).toBe('identity');
  });

  it('numbers and titles each step', () => {
    expect(stepNumber('identity')).toBe(1);
    expect(stepNumber('review')).toBe(4);
    expect(stepHeading('settings')).toBe('Cut settings');
  });
});

describe('wizard reducer', () => {
  it('sets identity and recipe without moving step', () => {
    const identity: IdentityDraft = { ...EMPTY_IDENTITY, materialName: 'Birch' };
    const afterIdentity = wizardReducer(state(), { kind: 'set-identity', identity });
    expect(afterIdentity.identity.materialName).toBe('Birch');
    expect(afterIdentity.step).toBe('identity');

    const nextRecipe = { ...recipe, power: 80 };
    const afterRecipe = wizardReducer(afterIdentity, { kind: 'set-recipe', recipe: nextRecipe });
    expect(afterRecipe.recipe.power).toBe(80);
    expect(afterRecipe.step).toBe('identity');
  });

  it('advances, retreats, and jumps via edit', () => {
    const atSettings = wizardReducer(state(), { kind: 'next' });
    expect(atSettings.step).toBe('settings');
    expect(wizardReducer(atSettings, { kind: 'back' }).step).toBe('identity');
    expect(wizardReducer(atSettings, { kind: 'edit', step: 'review' }).step).toBe('review');
  });
});

describe('identityComplete', () => {
  it('requires a name, description, and a positive thickness', () => {
    expect(identityComplete(EMPTY_IDENTITY)).toBe(false);
    const partial: IdentityDraft = { ...EMPTY_IDENTITY, materialName: 'Birch', description: 'Cut' };
    expect(identityComplete(partial)).toBe(false); // no thickness yet
    expect(identityComplete({ ...partial, thicknessMm: '3' })).toBe(true);
    expect(identityComplete({ ...partial, thicknessMm: '0' })).toBe(false);
    expect(identityComplete({ ...partial, thicknessMm: 'abc' })).toBe(false);
  });

  it('accepts a surface preset with a title instead of a thickness', () => {
    const surface: IdentityDraft = {
      ...EMPTY_IDENTITY,
      materialName: 'Birch',
      description: 'Score',
      thicknessMode: 'surface',
    };
    expect(identityComplete(surface)).toBe(false); // no title yet
    expect(identityComplete({ ...surface, title: 'Score' })).toBe(true);
  });
});
