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
import {
  prepareStartJob,
  prepareStartJobSnapshot,
  type StartJobPreparation,
} from './start-job-readiness';
import { prepareStartJobFromPrepared } from './start-job-readiness-prepared';
import { recoveryArtifactPreparedOutput } from './recovery-artifact-binding';
import { resolveRotaryRasterAllowed } from './start-job-external-environment';
import {
  outputPreparationShouldRunOffThread,
  prepareStartOutputOffThread,
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE,
} from './output-preparation-worker-client';

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
  requireFrame = true,
): Promise<StartJobPreparation> {
  const { project, jobPlacement } = app;
  const registration = currentPrintCutOutputRegistration(project);
  const machine = machineSnapshot(project, laser, camera);
  const useSnapshot = registration !== undefined || hasVariableText(project);
  const outputScope = currentOutputScope(app);
  if (useSnapshot || outputPreparationShouldRunOffThread(project, outputScope)) {
    return prepareCurrentStartInBackground({
      project,
      laser,
      machine,
      jobPlacement,
      outputScope,
      ...(resolvedJobOrigin === undefined ? {} : { resolvedJobOrigin }),
      allowRotaryRaster,
      requireFrame,
      registration,
      useSnapshot,
    });
  }
  return prepareStartJobSnapshot(
    project,
    laser.controllerSettings,
    machine,
    jobPlacement,
    outputScope,
    allowRotaryRaster,
    {
      clock: () => new Date(),
      renderVariableText,
      ...(registration === undefined ? {} : { registration }),
      ...(resolvedJobOrigin === undefined ? {} : { resolvedJobOrigin }),
      requireFrame,
    },
  );
}

async function prepareCurrentStartInBackground(args: {
  readonly project: Project;
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly machine: ReturnType<typeof machineSnapshot>;
  readonly jobPlacement: JobPlacementSettings;
  readonly outputScope: OutputScope;
  readonly resolvedJobOrigin?: JobOriginPlacement;
  readonly allowRotaryRaster: boolean;
  readonly requireFrame: boolean;
  readonly registration: ReturnType<typeof currentPrintCutOutputRegistration>;
  readonly useSnapshot: boolean;
}): Promise<StartJobPreparation> {
  const background = prepareStartOutputOffThread({
    kind: 'start',
    project: args.project,
    controllerSettings: args.laser.controllerSettings,
    machine: args.machine,
    jobPlacement: args.jobPlacement,
    outputScope: args.outputScope,
    ...(args.resolvedJobOrigin === undefined ? {} : { resolvedJobOrigin: args.resolvedJobOrigin }),
    allowRotaryRaster: args.allowRotaryRaster,
    requireFrame: args.requireFrame,
    ...(args.useSnapshot
      ? {
          snapshot: {
            evaluatedAtIso: new Date().toISOString(),
            ...(args.registration === undefined ? {} : { registration: args.registration }),
          },
        }
      : {}),
  });
  if (background === null) {
    return { ok: false, messages: [BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE] };
  }
  try {
    return await background;
  } catch (error) {
    console.warn('Background Start preparation failed.', error);
    return { ok: false, messages: [BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE] };
  }
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
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
  const recoveredPrepared = recoveryArtifactPreparedOutput(artifact);
  if (recoveredPrepared === null) {
    jobAwareAlert(
      'Cannot start supervised recovery:\n\nThe archived prepared job does not reproduce the saved exact G-code lineage. No controller command was sent.',
    );
    return null;
  }
  const project = artifact.prepared.project;
  const qualified = prepareStartJobFromPrepared(
    project,
    recoveredPrepared,
    laser.controllerSettings,
    machineSnapshot(project, laser, useCameraStore.getState()),
    jobPlacementForArchivedArtifact(artifact),
    artifact.outputScope,
    artifact.jobOrigin,
    resolveRotaryRasterAllowed(project),
  );
  if (!qualified.ok) {
    const lines = qualified.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot resume job:\n\n${lines}`);
    return null;
  }
  return {
    project,
    gcode: artifact.gcode,
    prepared: recoveredPrepared,
    canvasPlan: artifact.canvasPlan,
    warnings: qualified.warnings,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    laserResumeChain: artifact.laserResumeChain ?? [],
    ...(qualified.preflightMotionOffset === undefined
      ? {}
      : { preflightMotionOffset: qualified.preflightMotionOffset }),
    ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
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
  if (outputPreparationShouldRunOffThread(project, outputScope)) {
    jobAwareAlert(
      'Cannot resume job:\n\nBackground recovery compilation is not available in this flow. Reopen the project and use Frame, then Start, to prepare the job without blocking the canvas.',
    );
    return null;
  }
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
    controllerBuildInfo: laser.controllerBuildInfo,
    controllerBuildInfoObservation: laser.controllerBuildInfoObservation,
    wcoCache: laser.wcoCache,
    activeWcs: laser.activeWcs,
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
