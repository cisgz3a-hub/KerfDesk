import type { StatusQueryCapability } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import type { Project } from '../../core/scene';
import { cameraPlacementGeometryIssue } from '../camera/camera-surface-height';
import type { useCameraStore } from '../state/camera-store';
import type { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { connectedLaserModuleEvidence } from '../state/laser-module-probe';

/** Every controller and camera fact a Start preparation compiles against, as
 * one by-value snapshot. It is what the request carries into the preparation
 * worker and what `startMachineInputsKey` compares. */
export function machineSnapshot(
  project: Project,
  laser: ReturnType<typeof useLaserStore.getState>,
  camera: ReturnType<typeof useCameraStore.getState>,
) {
  return {
    connected: laser.connection.kind === 'connected',
    statusReport: laser.statusReport,
    alarmCode: laser.alarmCode,
    hasActiveStreamer: isActiveJob(laser.streamer),
    cncJobsSupported: laser.capabilities.cncJobs,
    motionOperationActive: laser.motionOperation !== null,
    controllerOperationActive: laser.controllerOperation !== null,
    autofocusBusy: laser.autofocusBusy,
    workOriginActive: laser.workOriginActive,
    workZZeroEvidence: laser.workZZeroEvidence,
    workZReferenceEpoch: laser.workZReferenceEpoch,
    controllerSessionEpoch: laser.controllerSessionEpoch,
    controllerBuildInfo: laser.controllerBuildInfo,
    controllerBuildInfoObservation: laser.controllerBuildInfoObservation,
    controllerSettings: laser.controllerSettings,
    controllerSettingsObservation: laser.controllerSettingsObservation,
    laserModuleReport: connectedLaserModuleEvidence(laser),
    wcoCache: laser.wcoCache,
    activeWcs: laser.activeWcs,
    ovCache: laser.ovCache,
    accessoryCache: laser.accessoryCache ?? null,
    frameVerification: laser.frameVerification,
    settingsCapability: laser.capabilities.settings,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
    activeControllerCommandSet: laser.activeControllerCommandSet,
    cameraPlacementActive: camera.placementActive,
    cameraConfirmedPositionEpoch: camera.confirmedPositionEpoch,
    cameraPlacementGeometryIssue: cameraPlacementGeometryIssue(
      project.device.cameraAlignment,
      project.device.cameraCalibration,
      camera.surfaceHeightMm,
    ),
    homingState: laser.homingState,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    reportInches: laser.controllerSettings?.reportInches === true,
    statusQuery: liveStatusQueryCapability(
      laser.activeControllerKind,
      laser.capabilities.statusQuery,
    ),
  };
}

function liveStatusQueryCapability(
  controllerKind: ControllerKind,
  configured: StatusQueryCapability,
): StatusQueryCapability {
  if (controllerKind === 'marlin') return 'queued-poll';
  if (controllerKind === 'ruida') return 'none';
  return configured;
}
