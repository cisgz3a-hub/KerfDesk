import { profileSupportsCapability } from '../../core/devices';
import type { Project } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';

export type StartExternalEnvironment = {
  readonly rotaryRasterAllowed: boolean;
};

export function captureStartExternalEnvironment(project: Project): StartExternalEnvironment {
  return {
    rotaryRasterAllowed: resolveRotaryRasterAllowed(project),
  };
}

export function startExternalEnvironmentMatches(
  expected: StartExternalEnvironment,
  project: Project,
): boolean {
  return resolveRotaryRasterAllowed(project) === expected.rotaryRasterAllowed;
}

export function resolveRotaryRasterAllowed(project: Project): boolean {
  return (
    useExperimentalLaserFeatures.getState().features.rotaryRaster &&
    profileSupportsCapability(project.device, 'rotary')
  );
}
