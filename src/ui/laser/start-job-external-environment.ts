import { profileSupportsCapability } from '../../core/devices';
import type { Project } from '../../core/scene';
import type { CameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';

type CameraStartEnvironment = Pick<
  CameraStore,
  'placementActive' | 'confirmedPositionEpoch' | 'surfaceHeightMm'
>;

export type StartExternalEnvironment = {
  readonly cameraPlacementActive: boolean;
  readonly cameraConfirmedPositionEpoch: number | null;
  readonly cameraSurfaceHeightMm: number;
  readonly rotaryRasterAllowed: boolean;
};

export function captureStartExternalEnvironment(
  project: Project,
  camera: CameraStartEnvironment,
): StartExternalEnvironment {
  return {
    cameraPlacementActive: camera.placementActive,
    cameraConfirmedPositionEpoch: camera.confirmedPositionEpoch,
    cameraSurfaceHeightMm: camera.surfaceHeightMm,
    rotaryRasterAllowed: resolveRotaryRasterAllowed(project),
  };
}

export function startExternalEnvironmentMatches(
  expected: StartExternalEnvironment,
  project: Project,
  camera: CameraStartEnvironment,
): boolean {
  return (
    camera.placementActive === expected.cameraPlacementActive &&
    camera.confirmedPositionEpoch === expected.cameraConfirmedPositionEpoch &&
    camera.surfaceHeightMm === expected.cameraSurfaceHeightMm &&
    resolveRotaryRasterAllowed(project) === expected.rotaryRasterAllowed
  );
}

export function resolveRotaryRasterAllowed(project: Project): boolean {
  return (
    useExperimentalLaserFeatures.getState().features.rotaryRaster &&
    profileSupportsCapability(project.device, 'rotary')
  );
}
