// runJobReviewGate — the flow-owned review loop between "G-code prepared"
// and "authorize + stream" (ADR-224). Opens the Job Review dialog with the
// freshly prepared job, re-runs the full prepare pipeline when the operator
// edits settings from inside the dialog, and returns only once the operator
// confirms (yielding the exact bundle that must stream) or cancels (null —
// zero side effects). The two former native start confirms are absorbed
// here: the dialog shows their exact prompt text, and a single Confirm
// produces the same LaserModeStartEvidence / CncSetupAttestation objects
// the transmission layer already consumes.

import type { JobCheckpoint } from '../../../core/recovery';
import { machineKindOf } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import type { CncSetupAttestation } from '../../state/cnc-setup-attestation';
import {
  captureLaserModeStartSnapshot,
  type LaserModeStartEvidence,
  type LaserModeStartSnapshot,
} from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import type { LastCompletedReceipt } from '../../state/recovery';
import { confirmCncSetup } from '../cnc-setup-acknowledgement';
import { confirmLaserModeStartEvidence } from '../laser-mode-start-acknowledgement';
import { checkpointProgramIssue } from '../start-job-checkpoint-policy';
import {
  COMPLETED_REPLAY_CHANGED_MESSAGE,
  currentReplayExecutionSignature,
  replayCompilationMatches,
} from '../start-job-execution-tracking';
import {
  captureStartExternalEnvironment,
  type StartExternalEnvironment,
} from '../start-job-external-environment';
import { prepareCurrentStartJob } from '../start-job-source';
import { buildJobReviewModel, type PreparedCurrentStart } from './job-review-model';
import { useJobReviewStore } from './job-review-store';

/** Everything one successful prepare ran against. Only ever replaced whole,
 * by another successful prepare, so the bundle that streams is provably the
 * bundle the operator last saw. */
export type ReviewedStartBundle = {
  readonly app: ReturnType<typeof useStore.getState>;
  readonly project: ReturnType<typeof useStore.getState>['project'];
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly prepared: PreparedCurrentStart;
  readonly laserModeStartSnapshot: LaserModeStartSnapshot;
  readonly externalEnvironment: StartExternalEnvironment;
};

export type ConfirmedJobReview = {
  readonly bundle: ReviewedStartBundle;
  readonly laserModeStartEvidence: LaserModeStartEvidence | undefined;
  readonly cncSetupAttestation: CncSetupAttestation | undefined;
};

export async function runJobReviewGate(args: {
  readonly initial: ReviewedStartBundle;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
}): Promise<ConfirmedJobReview | null> {
  let current = args.initial;
  if (!useJobReviewStore.getState().open(modelFor(current))) return null;
  for (;;) {
    const signal = await useJobReviewStore.getState().nextSignal();
    if (signal === 'cancel') {
      useJobReviewStore.getState().close();
      return null;
    }
    if (signal === 'confirm') {
      const confirmed = confirmReviewedStart(current);
      useJobReviewStore.getState().close();
      return confirmed;
    }
    useJobReviewStore.getState().beginPrepare();
    const rebuilt = await rebuildCurrentStart(args.checkpointToReplace, args.completedReceipt);
    if (!rebuilt.ok) {
      useJobReviewStore.getState().failPrepare(rebuilt.messages);
      continue;
    }
    current = rebuilt.bundle;
    useJobReviewStore.getState().completePrepare(modelFor(current));
  }
}

function modelFor(bundle: ReviewedStartBundle): ReturnType<typeof buildJobReviewModel> {
  return buildJobReviewModel({
    project: bundle.project,
    prepared: bundle.prepared,
    laserModeStartSnapshot: bundle.laserModeStartSnapshot,
    overrides: bundle.laser.ovCache,
  });
}

// A Confirm click is the acknowledgement: the dialog showed the exact prompt
// text, so the evidence builders run with an always-true confirm — one
// affirmative click, the same as accepting today's native dialogs.
function confirmReviewedStart(bundle: ReviewedStartBundle): ConfirmedJobReview {
  const machineKind = machineKindOf(bundle.project.machine);
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    bundle.project,
    bundle.laserModeStartSnapshot,
    () => true,
  );
  const cncSetupAttestation = confirmCncSetup(
    machineKind,
    bundle.prepared.gcode,
    bundle.laser.ovCache,
    () => true,
  );
  return {
    bundle,
    laserModeStartEvidence: laserModeStartEvidence ?? undefined,
    cncSetupAttestation: cncSetupAttestation ?? undefined,
  };
}

type RebuiltStart =
  | { readonly ok: true; readonly bundle: ReviewedStartBundle }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

// Mirrors the pre-review sequence of runStartJobFlowWithCheckpoint against
// the LIVE store state, minus its side effects: a refusal here becomes an
// in-dialog blocker (the same edit would refuse Start today) and never
// writes the StartBlocker store or discards receipts — Cancel after a failed
// rebuild must leave the app exactly as the operator found it.
async function rebuildCurrentStart(
  checkpointToReplace: JobCheckpoint | null,
  completedReceipt: LastCompletedReceipt | null,
): Promise<RebuiltStart> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const laserModeStartSnapshot = captureLaserModeStartSnapshot(laser);
  const externalEnvironment = captureStartExternalEnvironment(app.project, camera);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    externalEnvironment.rotaryRasterAllowed,
    completedReceipt?.artifact.jobOrigin,
  );
  if (!prepared.ok) return { ok: false, messages: prepared.messages };
  if (
    completedReceipt !== null &&
    (!replayCompilationMatches(prepared, completedReceipt) ||
      currentReplayExecutionSignature(app) !== completedReceipt.artifact.executionSignature)
  ) {
    return { ok: false, messages: [COMPLETED_REPLAY_CHANGED_MESSAGE] };
  }
  const programIssue = checkpointProgramIssue(checkpointToReplace, prepared.gcode);
  if (programIssue !== null) return { ok: false, messages: [programIssue] };
  return {
    ok: true,
    bundle: {
      app,
      project: app.project,
      laser,
      prepared,
      laserModeStartSnapshot,
      externalEnvironment,
    },
  };
}
