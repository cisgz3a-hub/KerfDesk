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
        getItem: () =>
          JSON.stringify({
            rotary: true,
            rotaryRaster: true,
            lowPowerFire: true,
            printAndCut: 'true',
          }),
      }),
    ).toEqual({
      ...DEFAULT_EXPERIMENTAL_LASER_FEATURES,
      lowPowerFire: true,
    });
  });

  it('persists changes and can reset every gate', () => {
    useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
    expect(readExperimentalLaserFeatures().lowPowerFire).toBe(true);

    useExperimentalLaserFeatures.getState().resetFeatures();
    expect(readExperimentalLaserFeatures()).toEqual(DEFAULT_EXPERIMENTAL_LASER_FEATURES);
  });

  it('ignores retired rotary gates from legacy persisted state', () => {
    const features = readExperimentalLaserFeatures({
      getItem: () => JSON.stringify({ rotary: true, rotaryRaster: true }),
    });
    expect(features).toEqual(DEFAULT_EXPERIMENTAL_LASER_FEATURES);
    expect(features).not.toHaveProperty('rotary');
    expect(features).not.toHaveProperty('rotaryRaster');
  });
});
