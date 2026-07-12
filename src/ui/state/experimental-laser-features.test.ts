import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_LASER_FEATURES,
  readExperimentalLaserFeatures,
  useExperimentalLaserFeatures,
} from './experimental-laser-features';

describe('experimental laser feature gates', () => {
  beforeEach(() => {
    localStorage.clear();
    useExperimentalLaserFeatures.setState({ features: DEFAULT_EXPERIMENTAL_LASER_FEATURES });
  });

  it('fails closed when storage is absent or malformed', () => {
    expect(readExperimentalLaserFeatures(null)).toEqual(DEFAULT_EXPERIMENTAL_LASER_FEATURES);
    expect(readExperimentalLaserFeatures({ getItem: () => '{bad json' })).toEqual(
      DEFAULT_EXPERIMENTAL_LASER_FEATURES,
    );
  });

  it('accepts only explicit true values from persisted state', () => {
    expect(
      readExperimentalLaserFeatures({
        getItem: () => JSON.stringify({ rotary: true, rotaryRaster: 'true', lowPowerFire: 1 }),
      }),
    ).toEqual({
      ...DEFAULT_EXPERIMENTAL_LASER_FEATURES,
      rotary: true,
    });
  });

  it('persists changes and can reset every gate', () => {
    useExperimentalLaserFeatures.getState().setFeature('rotary', true);
    expect(readExperimentalLaserFeatures().rotary).toBe(true);

    useExperimentalLaserFeatures.getState().resetFeatures();
    expect(readExperimentalLaserFeatures()).toEqual(DEFAULT_EXPERIMENTAL_LASER_FEATURES);
  });
});
