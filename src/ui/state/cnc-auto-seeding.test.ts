import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { refreshAutomaticCncFeeds } from './cnc-auto-seeding';

describe('refreshAutomaticCncFeeds', () => {
  it('withdraws unresolved material provenance while preserving every numeric setting', () => {
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'unknown-material',
      feedMmPerMin: 777,
      plungeMmPerMin: 123,
      spindleRpm: 10_000,
      depthPerPassMm: 0.4,
      feedSource: {
        kind: 'material-recipe' as const,
        materialKey: 'unknown-material',
        fluteCount: 2,
      },
    };
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: settings };

    const refreshed = refreshAutomaticCncFeeds(
      { objects: [], layers: [layer] },
      {
        device: DEFAULT_DEVICE_PROFILE,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        liveCaps: null,
      },
    );

    const { feedSource: _source, ...expected } = settings;
    expect(refreshed.layers[0]?.cnc).toEqual(expected);
    expect(refreshed.layers[0]?.cnc).not.toHaveProperty('feedSource');
  });
});
