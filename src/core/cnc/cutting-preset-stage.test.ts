import { describe, expect, it } from 'vitest';
import { CNC_CONTEXT_PRESET, CNC_CONTEXT_TOOL } from '../../__fixtures__/cnc-cutting-preset';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../scene';
import { cncSettingsForStage } from './cnc-stage-settings';

const RECIPE = {
  toolId: CNC_CONTEXT_TOOL.id,
  feedMmPerMin: 600,
  plungeMmPerMin: 120,
  spindleRpm: 11000,
  depthPerPassMm: 0.8,
  cuttingPreset: CNC_CONTEXT_PRESET,
};
describe('stage-local cutting record snapshots', () => {
  it('uses the secondary stage snapshot without borrowing the primary cutter baseline', () => {
    const primary = {
      ...CNC_CONTEXT_PRESET,
      id: 'primary',
      name: 'Primary values',
      feedMmPerMin: 950,
    };
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cuttingPreset: primary,
      stepoverPercent: 25,
      stageRecipes: { 'pocket-rough': RECIPE },
    };
    const effective = cncSettingsForStage(settings, 'pocket-rough', CNC_CONTEXT_TOOL);
    expect(effective.cuttingPreset).toEqual(CNC_CONTEXT_PRESET);
    expect(effective.feedMmPerMin).toBe(600);
    expect(effective.depthPerPassMm).toBe(0.8);
    expect(effective.stepoverPercent).toBe(25);
    expect(settings.feedMmPerMin).toBe(DEFAULT_CNC_LAYER_SETTINGS.feedMmPerMin);
  });
  it('does not inherit a primary snapshot into independent legacy stage values', () => {
    const { cuttingPreset: _saved, ...legacy } = RECIPE;
    const effective = cncSettingsForStage(
      {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cuttingPreset: CNC_CONTEXT_PRESET,
        stageRecipes: { 'v-clear': legacy },
      },
      'v-clear',
      CNC_CONTEXT_TOOL,
    );
    expect(effective).not.toHaveProperty('cuttingPreset');
    expect(effective.feedMmPerMin).toBe(600);
  });
  it('retains primary settings when a saved stage recipe belongs to another cutter', () => {
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cuttingPreset: CNC_CONTEXT_PRESET,
      stageRecipes: { 'relief-finish': { ...RECIPE, toolId: 'other' } },
    };
    expect(cncSettingsForStage(settings, 'relief-finish', CNC_CONTEXT_TOOL)).toBe(settings);
  });
});
