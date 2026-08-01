import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import {
  captureStartExternalEnvironment,
  startExternalEnvironmentMatches,
} from './start-job-external-environment';

afterEach(() => useExperimentalLaserFeatures.getState().resetFeatures());

describe('Start external environment', () => {
  it('keeps output-affecting rotary raster policy in the Frame handoff identity', () => {
    const base = createProject();
    const project = {
      ...base,
      device: { ...base.device, capabilities: ['rotary'] as const },
    };
    const framed = captureStartExternalEnvironment(project);

    useExperimentalLaserFeatures.getState().setFeature('rotaryRaster', true);

    expect(framed).toEqual({ rotaryRasterAllowed: false });
    expect(startExternalEnvironmentMatches(framed, project)).toBe(false);
  });
});
