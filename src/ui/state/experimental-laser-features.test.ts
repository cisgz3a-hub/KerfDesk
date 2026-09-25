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
      readExperimentalLaserFeatures({ getItem: () => JSON.stringify({ printAndCut: 'true' }) }),
    ).toEqual(DEFAULT_EXPERIMENTAL_LASER_FEATURES);
    expect(
      readExperimentalLaserFeatures({ getItem: () => JSON.stringify({ printAndCut: true }) }),
    ).toEqual({ printAndCut: true });
  });

  it('persists changes and can reset every gate', () => {
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    expect(readExperimentalLaserFeatures().printAndCut).toBe(true);

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

  // ADR-387: Fire and camera alignment left Labs. A store written while they
  // were gates must still load, keep Print and Cut, and carry nothing else.
  it('loads a store written while Fire and camera alignment were Labs gates', () => {
    const legacy = JSON.stringify({
      lowPowerFire: true,
      printAndCut: true,
      cameraAlignmentV2: true,
    });
    const features = readExperimentalLaserFeatures({ getItem: () => legacy });
    expect(features).toEqual({ printAndCut: true });
    expect(features).not.toHaveProperty('lowPowerFire');
    expect(features).not.toHaveProperty('cameraAlignmentV2');
  });

  it('drops the retired keys on the next write', () => {
    localStorage.setItem(
      'kerfdesk.experimental-laser-features.v1',
      JSON.stringify({ lowPowerFire: true, printAndCut: false, cameraAlignmentV2: true }),
    );
    useExperimentalLaserFeatures.setState({ features: readExperimentalLaserFeatures() });

    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);

    expect(JSON.parse(localStorage.getItem('kerfdesk.experimental-laser-features.v1')!)).toEqual({
      printAndCut: true,
    });
  });
});
