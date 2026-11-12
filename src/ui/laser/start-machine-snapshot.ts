import type { StatusQueryCapability } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import { reportedControllerAxes } from '../state/rotary-axis-frame';
import { rotaryTurnSinceAbort } from './abort-rotary-turn';
import type { Project } from '../../core/scene';
import { ownCameraModel } from '../camera/active-camera-model';
import { cameraPlacementGeometryIssue } from '../camera/camera-model-frame';
import { canvasTargetInScene } from '../camera/calibrate/canvas-target-burn';
import { cameraMovedStartWarning } from '../camera/helpers/camera-moved-start-warning';
import type { useCameraStore } from '../state/camera-store';
import type { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { focusMovedByHome } from '../state/home-moved-focus';
import { connectedLaserModuleEvidence } from '../state/laser-module-probe';
import { registrationOutlinePlacement } from '../state/registration-outline-run';
import { laserStatusReportFieldsOff } from '../state/status-report-fields';
import { isRestoredWorkOrigin } from '../state/work-origin-state';
import { controllerReportsWorkOffset } from './work-offset-assumption';

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
    // grblHAL's `$I` axes, when read this session (ADR-695).
    reportedAxisLetters: reportedControllerAxes(laser).axisLetters ?? null,
    rotaryTurnSinceAbort: rotaryTurnSinceAbort(laser),
    alarmCode: laser.alarmCode,
    hasActiveStreamer: isActiveJob(laser.streamer),
    cncJobsSupported: laser.capabilities.cncJobs,
    motionOperationActive: laser.motionOperation !== null,
    controllerOperationActive: laser.controllerOperation !== null,
    autofocusBusy: laser.autofocusBusy,
    // A Home moved Z since the height was last set (ADR-322 Amendment 5).
    focusMovedByHome: focusMovedByHome(laser),
    workOriginActive: laser.workOriginActive,
    workOriginRestored: isRestoredWorkOrigin(laser),
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
    cameraPlacementGeometryIssue: cameraPlacementGeometryIssue(project.device.cameraModel),
    // The camera target's rings, put on the canvas and unmoved (ADR-441 Amendment 10).
    cameraTargetOnCanvas: canvasTargetInScene(project),
    // ADR-663 Amendment 5: a showing "camera may have moved" warning.
    cameraMovedWarning: cameraMovedStartWarning(project.device, camera.sourceState),
    // The running camera's own calibration, for where its picture is only
    // estimated (ADR-441 Amendment 9).
    cameraCalibration: ownCameraModel(project.device, camera.sourceState) ?? null,
    registrationOutline: registrationOutlinePlacement(project, laser.registrationOutlineRun),
    homingState: laser.homingState,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    reportInches: laser.controllerSettings?.reportInches === true,
    statusQuery: liveStatusQueryCapability(
      laser.activeControllerKind,
      laser.capabilities.statusQuery,
    ),
    reportsWorkOffset: controllerReportsWorkOffset(laser.capabilities),
    statusReportFieldsOff: laserStatusReportFieldsOff(laser),
  };
}

function liveStatusQueryCapability(
  controllerKind: ControllerKind,
  configured: StatusQueryCapability,
): StatusQueryCapability {
  if (controllerKind === 'marlin') return 'queued-poll';
  if (controllerKind === 'ruida' || controllerKind === 'lihuiyu' || controllerKind === 'moshi')
    return 'none';
  return configured;
}
