import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../core/scene';
import { withManualCncFeedPatch, withoutCncFeedProvenance } from './cnc-feed-provenance';

const automaticSettings: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  materialKey: 'plywood-mdf',
  feedSource: {
    kind: 'material-recipe',
    materialKey: 'plywood-mdf',
    fluteCount: 2,
  },
};

describe('withManualCncFeedPatch', () => {
  it.each([
    ['toolId', { toolId: 'em-6350' }],
    ['depth per pass', { depthPerPassMm: 0.5 }],
    ['feed', { feedMmPerMin: 550 }],
    ['plunge', { plungeMmPerMin: 100 }],
    ['spindle', { spindleRpm: 10000 }],
  ] as const)('clears automatic provenance after a manual %s edit', (_label, patch) => {
    const result = withManualCncFeedPatch(automaticSettings, patch);

    expect(result).toMatchObject(patch);
    expect(result).not.toHaveProperty('feedSource');
    expect(result).not.toHaveProperty('materialKey');
  });

  it('preserves provenance for edits unrelated to feed calculation', () => {
    expect(withManualCncFeedPatch(automaticSettings, { tabsEnabled: true })).toEqual({
      ...automaticSettings,
      tabsEnabled: true,
    });
  });
});

describe('withoutCncFeedProvenance', () => {
  it('removes source metadata without changing numeric settings', () => {
    const result = withoutCncFeedProvenance(automaticSettings);

    expect(result.feedMmPerMin).toBe(automaticSettings.feedMmPerMin);
    expect(result.plungeMmPerMin).toBe(automaticSettings.plungeMmPerMin);
    expect(result.spindleRpm).toBe(automaticSettings.spindleRpm);
    expect(result.depthPerPassMm).toBe(automaticSettings.depthPerPassMm);
    expect(result).not.toHaveProperty('feedSource');
    expect(result).not.toHaveProperty('materialKey');
  });
});
