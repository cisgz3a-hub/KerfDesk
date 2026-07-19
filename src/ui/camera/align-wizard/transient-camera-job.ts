import { streamingModeForController } from '../../../core/devices';
import { DEFAULT_OUTPUT_SCOPE, machineKindOf, type Project } from '../../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../../job-placement';
import { useStore } from '../../state';
import { prepareStartJobSnapshot } from '../../laser/start-job-readiness';
import { useCameraStore } from '../../state/camera-store';
import { jobAwareAlert, jobAwareConfirm } from '../../state/job-aware-dialogs';
import {
  captureLaserModeStartSnapshot,
  type LaserModeStartSnapshot,
} from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';
import { renderVariableText } from '../../text/render-variable-text';
import { confirmCncSetup } from '../../laser/cnc-setup-acknowledgement';
import { framedRunReadinessIssue } from '../../laser/framed-run-readiness';
import {
  claimCurrentFramedRunStart,
  framedRunStartClaimIsCurrent,
  releaseFramedRunStartClaim,
} from '../../laser/framed-run-start-claim';
import { buildJobReviewModel, type ConfirmedJobReview } from '../../laser/job-review';
import {
  confirmLaserModeStartEvidence,
  laserModeStartAcknowledgementRequired,
} from '../../laser/laser-mode-start-acknowledgement';
import {
  dispatchTransientReviewedFrame,
  prepareTransientFrameController,
  type TransientFrameControllerPreparation,
} from '../../laser/use-frame-action';
import { captureStartExternalEnvironment } from '../../laser/start-job-external-environment';
import type { FramedRunPermit } from '../../state/framed-run';

const GRBL_LASER_MODE_SETTING = '$32';

/** Stream a temporary camera-calibration project without replacing, dirtying,
 * or adding undo entries to the operator's real project. */
export async function runTransientCameraJob(project: Project): Promise<boolean> {
  const controller = await prepareTransientFrameController(project);
  if (controller === null) return false;
  const review = await prepareTransientCameraReview(project, controller);
  if (review === null) return false;
  const permit = await dispatchTransientReviewedFrame(review, DEFAULT_OUTPUT_SCOPE);
  if (permit === null) return false;
  return startTransientFramedRun(permit);
}

async function prepareTransientCameraReview(
  project: Project,
  controller: TransientFrameControllerPreparation,
): Promise<ConfirmedJobReview | null> {
  const laser = controller.laser;
  const laserModeStartSnapshot = captureLaserModeStartSnapshot(laser);
  const camera = useCameraStore.getState();
  const prepared = await prepareStartJobSnapshot(
    project,
    laser.controllerSettings,
    transientMachineSnapshot(laser, camera),
    DEFAULT_JOB_PLACEMENT,
    DEFAULT_OUTPUT_SCOPE,
    false,
    { clock: () => new Date(), renderVariableText, requireFrame: false },
  );
  if (!prepared.ok) {
    jobAwareAlert(`Cannot burn camera markers:\n\n${bulletLines(prepared.messages)}`);
    return null;
  }
  const reviewModel = withFrameWarning(
    buildJobReviewModel({
      project,
      prepared,
      laserModeStartSnapshot,
      overrides: laser.ovCache,
    }),
    controller.wcsNormalizationWarning,
  );
  const cameraWarnings = warningsBeforeLaserModeAcknowledgement(
    project,
    laserModeStartSnapshot,
    reviewModel.warnings,
    prepared.gcode,
  );
  if (
    cameraWarnings.length > 0 &&
    !jobAwareConfirm(`Controller warning:\n\n${bulletLines(cameraWarnings)}\n\nBurn markers?`)
  ) {
    return null;
  }
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    project,
    laserModeStartSnapshot,
    jobAwareConfirm,
    prepared.gcode,
  );
  if (laserModeStartEvidence === null) return null;
  const machineKind = machineKindOf(project.machine);
  const cncSetupAttestation = confirmCncSetup(
    machineKind,
    prepared.gcode,
    laser.ovCache,
    jobAwareConfirm,
  );
  if (machineKind === 'cnc' && cncSetupAttestation === null) return null;
  const externalEnvironment = captureStartExternalEnvironment(project, camera);
  return {
    bundle: {
      app: useStore.getState(),
      project,
      laser,
      prepared,
      laserModeStartSnapshot,
      externalEnvironment,
      ...(controller.wcsNormalizationWarning === undefined
        ? {}
        : { frameWcsNormalizationWarning: controller.wcsNormalizationWarning }),
    },
    reviewedAtIso: new Date().toISOString(),
    reviewModel,
    laserModeStartEvidence,
    cncSetupAttestation: cncSetupAttestation ?? undefined,
  };
}

function transientMachineSnapshot(
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
    activeWcs: laser.activeWcs,
    ovCache: laser.ovCache,
    accessoryCache: laser.accessoryCache ?? null,
    settingsCapability: laser.capabilities.settings,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
    controllerBuildInfo: laser.controllerBuildInfo,
    controllerBuildInfoObservation: laser.controllerBuildInfoObservation,
    cameraPlacementActive: true,
    cameraConfirmedPositionEpoch: camera.confirmedPositionEpoch,
    homingState: laser.homingState,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
  };
}

async function startTransientFramedRun(permit: FramedRunPermit): Promise<boolean> {
  const claim = claimCurrentFramedRunStart(permit);
  if (claim === null) {
    jobAwareAlert(
      'Could not burn camera markers:\n\nThe completed Frame is already being started.',
    );
    return false;
  }
  const candidate = permit.candidate;
  try {
    const readinessIssue = framedRunReadinessIssue(permit);
    if (readinessIssue !== null) throw new Error(readinessIssue);
    await useLaserStore.getState().startJob(candidate.preparedStart.gcode, {
      streamingMode: streamingModeForController(
        candidate.project.device.controllerKind,
        candidate.project.device.streamingMode,
      ),
      rxBufferBytes: candidate.project.device.rxBufferBytes,
      machineKind: machineKindOf(candidate.project.machine),
      framedRunPermit: permit,
      assertFinalStartAuthorized: () => {
        if (!framedRunStartClaimIsCurrent(claim)) {
          throw new Error(
            'The completed camera-marker Frame permit was consumed, replaced, or revoked before Start.',
          );
        }
        const issue = framedRunReadinessIssue(permit);
        if (issue !== null) throw new Error(issue);
      },
      ...(candidate.laserModeStartEvidence === undefined
        ? {}
        : { laserModeStartEvidence: candidate.laserModeStartEvidence }),
      ...(candidate.preparedStart.cncToolPlan === undefined
        ? {}
        : { cncToolPlan: candidate.preparedStart.cncToolPlan }),
      ...(candidate.cncSetupAttestation === undefined
        ? {}
        : { cncSetupAttestation: candidate.cncSetupAttestation }),
      canvasPlan: candidate.preparedStart.canvasPlan,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobAwareAlert(`Could not burn camera markers:\n\n${message}`);
    return false;
  } finally {
    releaseFramedRunStartClaim(claim);
  }
}

function withFrameWarning(
  model: ReturnType<typeof buildJobReviewModel>,
  warning: string | undefined,
): ReturnType<typeof buildJobReviewModel> {
  if (warning === undefined || model.warnings.includes(warning)) return model;
  return { ...model, warnings: [warning, ...model.warnings] };
}

function bulletLines(messages: ReadonlyArray<string>): string {
  return messages.map((message) => `- ${message}`).join('\n');
}

function warningsBeforeLaserModeAcknowledgement(
  project: Project,
  snapshot: LaserModeStartSnapshot,
  warnings: ReadonlyArray<string>,
  gcode: string,
): ReadonlyArray<string> {
  if (!laserModeStartAcknowledgementRequired(project, snapshot, gcode)) return warnings;
  return warnings.filter((warning) => !warning.includes(GRBL_LASER_MODE_SETTING));
}
