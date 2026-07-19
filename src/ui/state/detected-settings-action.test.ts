import { beforeEach, describe, expect, it } from 'vitest';
import { idleCollector } from '../../core/controllers/grbl';
import {
  beginSettingsCollection,
  publishCncLiveCaps,
  type DetectedSettingsRefs,
} from './detected-settings-action';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function refs(): DetectedSettingsRefs {
  return { settingsCollector: idleCollector(), settingsCollectorSessionEpoch: null };
}

beforeEach(resetStore);

describe('CNC live controller-cap lifecycle', () => {
  it('publishes a completed settings observation for future automatic settings', () => {
    publishCncLiveCaps({
      maxFeedX: 500,
      maxFeedY: 450,
      zMaxFeed: 80,
      maxPowerS: 10_000,
      laserModeEnabled: false,
    });

    expect(useStore.getState().cncLiveCaps).toEqual({
      xMaxFeedMmPerMin: 500,
      yMaxFeedMmPerMin: 450,
      zMaxFeedMmPerMin: 80,
      spindleMaxRpm: 10_000,
    });
  });

  it('clears the previous observation as soon as a replacement read begins', () => {
    useStore.getState().setCncLiveCaps({ xMaxFeedMmPerMin: 500 });
    const state = refs();

    beginSettingsCollection(state, 7);

    expect(useStore.getState().cncLiveCaps).toBeNull();
    expect(state.settingsCollector.kind).toBe('collecting');
    expect(state.settingsCollectorSessionEpoch).toBe(7);
  });
});
