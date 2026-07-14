import type { Project } from '../../core/scene';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type ResolvedJobPlacement,
} from '../job-placement';
import { cameraPlacementSafetyIssue } from '../camera/camera-placement-safety';
import { cameraPlacementGeometryIssue } from '../camera/camera-surface-height';
import { useCameraStore } from '../state/camera-store';
import type { HomingState } from '../state/laser-store';

type CameraFrameMachineSnapshot = MachinePlacementSnapshot & {
  readonly homingState: HomingState;
  readonly trustedPositionEpoch: number | undefined;
};

export function resolveCameraSafeFramePlacement(
  project: Project,
  jobPlacement: JobPlacementSettings,
  machine: CameraFrameMachineSnapshot,
): ResolvedJobPlacement {
  const camera = useCameraStore.getState();
  const issue = cameraPlacementSafetyIssue({
    active: camera.placementActive,
    startFrom: jobPlacement.startFrom,
    homingEnabled: project.device.homing.enabled,
    homingState: machine.homingState,
    trustedPositionEpoch: machine.trustedPositionEpoch ?? 0,
    confirmedPositionEpoch: camera.confirmedPositionEpoch,
    geometryIssue: cameraPlacementGeometryIssue(
      project.device.cameraAlignment,
      project.device.cameraCalibration,
      camera.surfaceHeightMm,
    ),
  });
  return issue === null
    ? resolveJobPlacement(jobPlacement, machine)
    : { ok: false, messages: [issue] };
}
