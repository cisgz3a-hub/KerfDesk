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
import { streamingModeForController } from '../../../core/devices';
import { machineKindOf, type OutputScope } from '../../../core/scene';
import { useStore } from '../../state';
import { currentOutputScope } from '../../state/output-scope-state';
import { useCameraStore } from '../../state/camera-store';
import type { CncSetupAttestation } from '../../state/cnc-setup-attestation';
import {
  captureLaserModeStartSnapshot,
  type LaserModeStartEvidence,
  type LaserModeStartSnapshot,
} from '../../state/laser-mode-start-evidence';
import { resolveStartStreamWindow } from '../../state/laser-job-effective-stream-options';
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
import { requiredFrameIssueFromPrepared } from '../required-frame-readiness';
import { prepareCurrentStartJob } from '../start-job-source';
import {
  buildJobReviewModel,
  type JobReviewModel,
  type PreparedCurrentStart,
} from './job-review-model';
import { detectFluidncDivergenceWarnings } from './fluidnc-divergence-warnings';
import { useJobReviewStore, type JobReviewPurpose } from './job-review-store';
import { refreshControllerIdentityWarnings } from '../controller-identity-warnings';
import { appendExternalGcodePreviewWarning } from '../../state/external-gcode-preview-disclosure';
import { isOutputPreparationAbort } from '../output-preparation-errors';
import { ownJobReviewPreparation } from './job-review-preparation-owner';

/** Everything one successful prepare ran against. Only ever replaced whole,
 * by another successful prepare, so the bundle that streams is provably the
 * bundle the operator last saw. */
export type ReviewedStartBundle = {
  readonly app: ReturnType<typeof useStore.getState>;
  readonly project: ReturnType<typeof useStore.getState>['project'];
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly prepared: PreparedCurrentStart;
  readonly laserModeStartSnapshot: LaserModeStartSnapshot;
  readonly outputScope?: OutputScope;
  /** Durable disclosure for the owned pre-Frame G54 selection. Rebuilds run
   * after that selection, so they must retain the original named WCS fact. */
  readonly frameWcsNormalizationWarning?: string;
};

export type ConfirmedJobReview = {
  readonly bundle: ReviewedStartBundle;
  readonly reviewedAtIso: string;
  readonly reviewModel: JobReviewModel;
  readonly laserModeStartEvidence: LaserModeStartEvidence | undefined;
  readonly cncSetupAttestation: CncSetupAttestation | undefined;
};

export async function runJobReviewGate(args: {
  readonly initial: ReviewedStartBundle;
  readonly checkpointToReplace: JobCheckpoint | null;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly purpose?: JobReviewPurpose;
  readonly onCompletedReplayChanged?: () => Promise<void> | void;
  /** Exact-handoff owner check for a pre-existing permit. */
  readonly shouldAbandon?: () => boolean;
}): Promise<ConfirmedJobReview | null> {
  const purpose = args.purpose ?? 'start';
  let current = args.initial;
  let displayedModel = modelFor(current);
  if (!useJobReviewStore.getState().open(displayedModel, purpose)) return null;
  const owner = ownJobReviewPreparation();
  try {
    for (;;) {
      const signal = await owner.nextSignal();
      if (reviewShouldClose(signal, args.shouldAbandon)) return null;
      // A field commit and the review rebuild request are both debounced. A
      // fast Confirm can therefore arrive before that request. Re-prepare
      // synchronously at this handoff boundary so approval can never bind to
      // stale bytes or stale live evidence.
      useJobReviewStore.getState().beginPrepare();
      const rebuilt = await rebuildReviewedStart(
        args.checkpointToReplace,
        args.completedReceipt,
        purpose,
        current,
        args.onCompletedReplayChanged,
        owner.signal,
      );
      if (reviewPreparationWasCancelled(owner.signal, args.shouldAbandon)) return null;
      if (!rebuilt.ok) {
        if (presentRebuildFailure(rebuilt)) return null;
        continue;
      }
      const rebuiltModel = modelFor(rebuilt.bundle);
      if (
        signal === 'confirm' &&
        sameReviewedArtifact(current, displayedModel, rebuilt.bundle, rebuiltModel)
      ) {
        return confirmReviewedStart(rebuilt.bundle, rebuiltModel);
      }
      // Changed bytes/evidence need a new affirmative click after display.
      current = rebuilt.bundle;
      displayedModel = rebuiltModel;
      useJobReviewStore.getState().completePrepare(displayedModel);
    }
  } catch (error) {
    if (isOutputPreparationAbort(error)) return null;
    throw error;
  } finally {
    owner.dispose();
  }
}

function reviewPreparationWasCancelled(
  signal: AbortSignal,
  shouldAbandon: (() => boolean) | undefined,
): boolean {
  return signal.aborted || shouldAbandon?.() === true;
}

function reviewShouldClose(
  signal: 'cancel' | 'confirm' | 'rebuild',
  shouldAbandon: (() => boolean) | undefined,
): boolean {
  return signal === 'cancel' || shouldAbandon?.() === true;
}

function sameReviewedArtifact(
  current: ReviewedStartBundle,
  displayedModel: JobReviewModel,
  rebuilt: ReviewedStartBundle,
  rebuiltModel: JobReviewModel,
): boolean {
  return (
    current.prepared.gcode === rebuilt.prepared.gcode &&
    JSON.stringify(displayedModel) === JSON.stringify(rebuiltModel)
  );
}

function modelFor(bundle: ReviewedStartBundle): ReturnType<typeof buildJobReviewModel> {
  const liveLaser = useLaserStore.getState();
  const configured = bundle.project.device.controllerKind ?? 'grbl-v1.1';
  const device = bundle.project.device;
  const baseModel = buildJobReviewModel({
    project: bundle.project,
    prepared: bundle.prepared,
    laserModeStartSnapshot: bundle.laserModeStartSnapshot,
    overrides: bundle.laser.ovCache,
    outputScope: bundle.outputScope ?? currentOutputScope(bundle.app),
    // The same window resolution the Start boundary applies, from the live
    // controller evidence at review time (ADR-331). Advisory only.
    streamThroughput: {
      window: resolveStartStreamWindow(
        {
          streamingMode: streamingModeForController(device.controllerKind, device.streamingMode),
          rxBufferBytes: device.rxBufferBytes,
        },
        liveLaser,
        liveLaser.activeControllerKind,
      ),
      controllerKind: liveLaser.activeControllerKind,
    },
  });
  // FluidNC disclosures need the live identities, not just the profile, so
  // they join here rather than inside buildJobReviewModel. Advisory only.
  const fluidnc = detectFluidncDivergenceWarnings({
    configured,
    active: liveLaser.activeControllerKind,
    detected: liveLaser.detectedControllerKind,
    gcode: bundle.prepared.gcode,
  });
  const disclosed =
    fluidnc.length === 0
      ? baseModel
      : { ...baseModel, warnings: [...baseModel.warnings, ...fluidnc] };
  const warning = bundle.frameWcsNormalizationWarning;
  const framedModel =
    warning === undefined || disclosed.warnings.includes(warning)
      ? disclosed
      : { ...disclosed, warnings: [warning, ...disclosed.warnings] };
  const externalPreview = useStore.getState().externalGcodePreview;
  const model = appendExternalGcodePreviewWarning(framedModel, externalPreview?.name);
  return refreshControllerIdentityWarnings(
    model,
    configured,
    liveLaser.activeControllerKind,
    liveLaser.detectedControllerKind,
  );
}

// A Confirm click is the acknowledgement: the dialog showed the exact prompt
// text, so the evidence builders run with an always-true confirm — one
// affirmative click, the same as accepting today's native dialogs.
function confirmReviewedStart(
  bundle: ReviewedStartBundle,
  reviewModel: JobReviewModel,
): ConfirmedJobReview {
  const machineKind = machineKindOf(bundle.project.machine);
  const laserModeStartEvidence = confirmLaserModeStartEvidence(
    bundle.project,
    bundle.laserModeStartSnapshot,
    () => true,
    bundle.prepared.gcode,
  );
  const cncSetupAttestation = confirmCncSetup(
    machineKind,
    bundle.prepared.gcode,
    bundle.laser.ovCache,
    () => true,
  );
  return {
    bundle,
    reviewedAtIso: new Date().toISOString(),
    reviewModel,
    laserModeStartEvidence: laserModeStartEvidence ?? undefined,
    cncSetupAttestation: cncSetupAttestation ?? undefined,
  };
}

type RebuiltStart =
  | { readonly ok: true; readonly bundle: ReviewedStartBundle }
  | {
      readonly ok: false;
      readonly messages: ReadonlyArray<string>;
      readonly closeReview?: true;
      /** The exact compile the refusal was raised against, when one exists.
       * Shown so the operator reviews the job they edited; never startable. */
      readonly display?: ReviewedStartBundle;
    };

function refreshFrozenReview(bundle: ReviewedStartBundle): RebuiltStart {
  const laser = useLaserStore.getState();
  return {
    ok: true,
    bundle: { ...bundle, laser, laserModeStartSnapshot: captureLaserModeStartSnapshot(laser) },
  };
}

function presentRebuildFailure(rebuilt: Extract<RebuiltStart, { readonly ok: false }>): boolean {
  if (rebuilt.closeReview === true) {
    useJobReviewStore.getState().close();
    return true;
  }
  // Publish the compiled model first, then the blocker over it: the stats,
  // warnings, and per-operation compiled summaries follow the edit while
  // Confirm stays unavailable until the operator resolves the refusal.
  if (rebuilt.display !== undefined) {
    useJobReviewStore.getState().completePrepare(modelFor(rebuilt.display));
  }
  useJobReviewStore.getState().failPrepare(rebuilt.messages);
  return false;
}

// Mirrors the pre-review sequence of runStartJobFlowWithCheckpoint against
// the LIVE store state, minus its side effects: a refusal here becomes an
// in-dialog blocker (the same edit would refuse Start today) and never
// writes the StartBlocker store or discards receipts — Cancel after a failed
// rebuild must leave the app exactly as the operator found it.
async function rebuildReviewedStart(
  checkpointToReplace: JobCheckpoint | null,
  completedReceipt: LastCompletedReceipt | null,
  purpose: JobReviewPurpose,
  previousBundle: ReviewedStartBundle,
  onCompletedReplayChanged: (() => Promise<void> | void) | undefined,
  signal: AbortSignal,
): Promise<RebuiltStart> {
  return purpose === 'laser-second-pass'
    ? refreshFrozenReview(previousBundle)
    : rebuildCurrentStart(
        checkpointToReplace,
        completedReceipt,
        purpose,
        previousBundle,
        onCompletedReplayChanged,
        signal,
      );
}

async function rebuildCurrentStart(
  checkpointToReplace: JobCheckpoint | null,
  completedReceipt: LastCompletedReceipt | null,
  purpose: JobReviewPurpose,
  previousBundle: ReviewedStartBundle,
  onCompletedReplayChanged: (() => Promise<void> | void) | undefined,
  signal: AbortSignal,
): Promise<RebuiltStart> {
  const frameWcsNormalizationWarning = previousBundle.frameWcsNormalizationWarning;
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const laserModeStartSnapshot = captureLaserModeStartSnapshot(laser);
  if (
    completedReceipt !== null &&
    currentReplayExecutionSignature(app) !== completedReceipt.artifact.executionSignature
  ) {
    await onCompletedReplayChanged?.();
    return { ok: false, messages: [COMPLETED_REPLAY_CHANGED_MESSAGE], closeReview: true };
  }
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    completedReceipt?.artifact.jobOrigin,
    // The frame-first gate is applied below, after the compile, so a job
    // edited inside the review can still refresh the review it is shown in.
    false,
    signal,
  );
  if (!prepared.ok) return { ok: false, messages: prepared.messages };
  const bundle: ReviewedStartBundle = {
    app,
    project: app.project,
    laser,
    prepared,
    laserModeStartSnapshot,
    ...(frameWcsNormalizationWarning === undefined ? {} : { frameWcsNormalizationWarning }),
  };
  const frameRefusal = frameFirstRefusal(purpose, bundle);
  if (frameRefusal !== null) return frameRefusal;
  if (completedReceipt !== null && !replayCompilationMatches(prepared, completedReceipt)) {
    await onCompletedReplayChanged?.();
    return { ok: false, messages: [COMPLETED_REPLAY_CHANGED_MESSAGE], closeReview: true };
  }
  const programIssue = checkpointProgramIssue(checkpointToReplace, prepared.gcode);
  if (programIssue !== null) return { ok: false, messages: [programIssue] };
  return { ok: true, bundle };
}

// Frame-first (ADR-228): Start needs a Frame of this exact compiled job. The
// prepare pipeline used to refuse this inside the compile and drop the
// result, which left the dialog showing the LAST framed job's stats and
// "Partial compiled summary" after an edit — the operator changed 30% to 49%
// and kept reading 30%. The refusal still blocks Confirm exactly as before;
// the compile now travels with it so the review shows the edited job while
// the banner asks for the re-Frame.
function frameFirstRefusal(
  purpose: JobReviewPurpose,
  bundle: ReviewedStartBundle,
): Extract<RebuiltStart, { readonly ok: false }> | null {
  if (purpose !== 'start') return null;
  const frameIssue = requiredFrameIssueFromPrepared({
    prepared: bundle.prepared.prepared,
    machine: bundle.laser,
  });
  return frameIssue === null ? null : { ok: false, messages: [frameIssue], display: bundle };
}
