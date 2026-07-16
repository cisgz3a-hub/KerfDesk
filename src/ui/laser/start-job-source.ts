import type { StatusQueryCapability } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import type { JobOriginPlacement, JobPlacementSettings } from '../../core/job';
import type { PreflightOptions } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { currentOutputScope, useStore } from '../state';
import { cameraPlacementGeometryIssue } from '../camera/camera-surface-height';
import { useCameraStore } from '../state/camera-store';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import {
  captureLaserModeStartSnapshot,
  type LaserModeStartSnapshot,
} from '../state/laser-mode-start-evidence';
import type { ExecutionArtifactV1 } from '../state/recovery';
import { renderVariableText } from '../text/render-variable-text';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { prepareStartJob, prepareStartJobSnapshot } from './start-job-readiness';
import { recoveryArtifactPreparedProgramMatches } from './recovery-artifact-binding';
import { resolveRotaryRasterAllowed } from './start-job-external-environment';

export type PreparedRecoverySource = {
  readonly project: Project;
  readonly gcode: string;
  readonly canvasPlan: CanvasMotionPlan;
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly warnings: ReadonlyArray<string>;
  readonly laserModeStartSnapshot: LaserModeStartSnapshot;
  readonly laserResumeChain: NonNullable<ExecutionArtifactV1['laserResumeChain']>;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  readonly jobOrigin?: JobOriginPlacement;
};

export async function prepareCurrentStartJob(
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  camera: ReturnType<typeof useCameraStore.getState>,
  allowRotaryRaster = resolveRotaryRasterAllowed(app.project),
  resolvedJobOrigin?: JobOriginPlacement,
) {
  const { project, jobPlacement } = app;
  const registration = currentPrintCutOutputRegistration(project);
  return prepareStartJobSnapshot(
    project,
    laser.controllerSettings,
    machineSnapshot(project, laser, camera),
    jobPlacement,
    currentOutputScope(app),
    allowRotaryRaster,
    {
      clock: () => new Date(),
      renderVariableText,
      ...(registration === undefined ? {} : { registration }),
      ...(resolvedJobOrigin === undefined ? {} : { resolvedJobOrigin }),
    },
  );
}

export function prepareRecoverySource(overrides?: {
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
}): PreparedRecoverySource | null {
  if (!requireFreshControllerQualification()) return null;
  const app = useStore.getState();
  return prepareRecoveryProjectSource(
    app.project,
    app.jobPlacement,
    overrides?.outputScope ?? currentOutputScope(app),
    overrides?.jobOrigin,
  );
}

/** Qualifies an immutable exact artifact against the live controller without
 * consulting or replacing the open project. Archived observations are always
 * diagnostics; every safety decision uses the current controller state. */
export function prepareArchivedRecoverySource(
  artifact: ExecutionArtifactV1,
): PreparedRecoverySource | null {
  const laser = useLaserStore.getState();
  if (!requireFreshControllerQualification(laser)) return null;
  if (laser.activeControllerKind !== artifact.controller.kind) {
    jobAwareAlert(
      `Cannot start supervised recovery:\n\nThis job was prepared for ${artifact.controller.kind}, but the active controller is ${laser.activeControllerKind}. Connect the matching controller and requalify it.`,
    );
    return null;
  }
  const checked = prepareRecoveryProjectSource(
    artifact.prepared.project,
    jobPlacementForArchivedArtifact(artifact),
    artifact.outputScope,
    artifact.jobOrigin,
  );
  if (checked === null) return null;
  if (!recoveryArtifactPreparedProgramMatches(artifact)) {
    jobAwareAlert(
      'Cannot start supervised recovery:\n\nThe archived prepared job does not reproduce the saved exact G-code lineage. No controller command was sent.',
    );
    return null;
  }
  return {
    ...checked,
    project: artifact.prepared.project,
    gcode: artifact.gcode,
    prepared: artifact.prepared,
    canvasPlan: artifact.canvasPlan,
    laserResumeChain: artifact.laserResumeChain ?? [],
  };
}

function requireFreshControllerQualification(
  laser: ReturnType<typeof useLaserStore.getState> = useLaserStore.getState(),
): boolean {
  if (
    laser.controllerQualification.kind === 'qualified' &&
    laser.controllerQualification.epoch === laser.controllerSessionEpoch
  ) {
    return true;
  }
  jobAwareAlert(
    'Cannot start supervised recovery:\n\nThe connected controller has not completed fresh qualification. Retry reading controller settings first.',
  );
  return false;
}

function prepareRecoveryProjectSource(
  project: Project,
  jobPlacement: JobPlacementSettings,
  outputScope: OutputScope,
  resolvedJobOrigin?: JobOriginPlacement,
): PreparedRecoverySource | null {
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = prepareStartJob(
    project,
    laser.controllerSettings,
    machineSnapshot(project, laser, camera),
    jobPlacement,
    outputScope,
    resolvedJobOrigin,
    resolveRotaryRasterAllowed(project),
  );
  if (!prepared.ok) {
    const lines = prepared.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot resume job:\n\n${lines}`);
    return null;
  }
  return {
    project,
    gcode: prepared.gcode,
    canvasPlan: prepared.canvasPlan,
    prepared: prepared.prepared,
    warnings: prepared.warnings,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    laserResumeChain: [],
    ...(prepared.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: prepared.preflightMotionOffset }),
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
  };
}

function machineSnapshot(
  project: Project,
  laser: ReturnType<typeof useLaserStore.getState>,
  camera: ReturnType<typeof useCameraStore.getState>,
) {
  return {
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
    wcoCache: laser.wcoCache,
    ovCache: laser.ovCache,
    accessoryCache: laser.accessoryCache ?? null,
    frameVerification: laser.frameVerification,
    settingsCapability: laser.capabilities.settings,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
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

function jobPlacementForArchivedArtifact(artifact: ExecutionArtifactV1): JobPlacementSettings {
  return {
    startFrom: artifact.jobOrigin?.startFrom ?? 'absolute',
    anchor: artifact.jobOrigin?.anchor ?? 'front-left',
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
