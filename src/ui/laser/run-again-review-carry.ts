// Run again of an unchanged, already-reviewed laser job (ADR-237 Amendment 3).
//
// Run again follows Start, and Start opens Job Review. When the review that
// dialog would show is the one the operator already confirmed for the run being
// repeated, showing it again asks for the same click once per coaster. This
// module decides, for one Run again, whether that earlier confirmation may
// stand in for the dialog.
//
// It answers the review gate through the gate's own presenter seam. The gate
// therefore still prepares again at the handoff boundary, still refuses a
// changed artifact, a blocker and an open machine-type question, and still
// builds the review evidence from the fresh preparation. Every case this
// module does not positively recognise opens the dialog as an ordinary Start
// does.

import { machineKindOf } from '../../core/scene';
import type { FramedRunPermit, FramedRunReviewEvidence } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import type { LastCompletedReceipt } from '../state/recovery';
import type { ReviewCarriedOverV2 } from '../state/recovery/execution-workflow-evidence';
import {
  noteSessionReviewedRun,
  sessionReviewedRun,
  type SessionReviewedRun,
} from '../state/session-reviewed-runs';
import { useToastStore } from '../state/toast-store';
import type { FramedStartOptions } from './framed-start-options';
import {
  useJobReviewStore,
  type ConfirmedJobReview,
  type JobReviewModel,
  type JobReviewPurpose,
  type ReviewedStartBundle,
} from './job-review';
import {
  createJobReviewPresentation,
  type JobReviewPresentation,
  type JobReviewPresenter,
} from './job-review/job-review-presentation';
import { replayCompilationMatches } from './start-job-execution-tracking';

export const RUN_AGAIN_CARRIED_REVIEW_TOAST_KEY = 'run-again-carried-review';

export type RunAgainReviewCarry = {
  /** Shows the dialog, or stands in for it when the shown review would be the
   * one already confirmed. */
  readonly presenter: JobReviewPresenter;
  /** True once the presenter stood in for the dialog, whether or not the gate
   * then accepted its answer. */
  readonly stoodInForDialog: () => boolean;
  /** The record for a review the gate confirmed without the dialog; null when
   * that review is not the confirmed one after all, so the dialog must show. */
  readonly carriedOver: (review: ConfirmedJobReview) => ReviewCarriedOverV2 | null;
};

/** Null when this Start has no earlier confirmation to carry: every Start that
 * is not a local Run again of a laser job reviewed in this app session, on
 * this controller session, running the completed run's exact program. */
export function runAgainReviewCarry(args: {
  readonly permit: FramedRunPermit;
  readonly initial: ReviewedStartBundle;
  readonly completedReceipt: LastCompletedReceipt | null;
  readonly options: FramedStartOptions;
}): RunAgainReviewCarry | null {
  const receipt = args.completedReceipt;
  if (receipt === null || !isOrdinaryDesktopReview(args.permit, args.options)) return null;
  const approved = approvedReviewOf(receipt, args.initial);
  if (approved === null) return null;
  let stoodIn = false;
  return {
    presenter: (model, purpose) => {
      if (!reviewNeedsNoClick(model, purpose, approved)) {
        return createJobReviewPresentation(model, purpose);
      }
      stoodIn = true;
      return standInPresentation();
    },
    stoodInForDialog: () => stoodIn,
    carriedOver: (review) => {
      // The gate usually confirms the very preparation it was given; a rebuilt
      // one is compared with the completed run again.
      const sameProgram =
        review.bundle.prepared === args.initial.prepared ||
        replayCompilationMatches(review.bundle.prepared, receipt);
      return sameProgram ? carriedOverRecord(review, receipt, approved) : null;
    },
  };
}

// A remote approval sheet and a tool-owned permit (camera marker, painted
// second pass) keep their own review; only the desktop dialog is stood in for.
function isOrdinaryDesktopReview(permit: FramedRunPermit, options: FramedStartOptions): boolean {
  return options.presenter === undefined && permit.candidate.authorizationContext === undefined;
}

function approvedReviewOf(
  receipt: LastCompletedReceipt,
  bundle: ReviewedStartBundle,
): SessionReviewedRun | null {
  // The CNC setup attestation is a per-run affirmation and is always clicked.
  if (machineKindOf(bundle.project.machine) !== 'laser') return null;
  const approved = sessionReviewedRun(receipt.runId);
  if (approved === null) return null;
  if (approved.controllerSessionEpoch !== bundle.laser.controllerSessionEpoch) return null;
  if (!archivedReviewAgrees(receipt, approved)) return null;
  return replayCompilationMatches(bundle.prepared, receipt) ? approved : null;
}

// The completed run's own archive must tell the same story as this session's
// memory of it; a record that disagrees is not one to build on.
function archivedReviewAgrees(
  receipt: LastCompletedReceipt,
  approved: SessionReviewedRun,
): boolean {
  const provenance = receipt.artifact.provenance;
  if (provenance === undefined || provenance.schemaVersion !== 2) return false;
  return (
    provenance.workflow.kind === 'ordinary-start' &&
    provenance.controller.sessionEpoch === approved.controllerSessionEpoch &&
    sameWarningSet(provenance.review.warningsShown, approved.warnings)
  );
}

/** Whether the dialog for `model` would ask nothing new: no acknowledgement,
 * no machine-type question, and exactly the warnings already confirmed. */
function reviewNeedsNoClick(
  model: JobReviewModel,
  purpose: JobReviewPurpose,
  approved: SessionReviewedRun,
): boolean {
  return (
    purpose === 'start' &&
    model.machineKind === 'laser' &&
    reviewAsksNothing(model.acknowledgement) &&
    model.convertedLaser === undefined &&
    sameWarningSet(model.warnings, approved.warnings) &&
    useJobReviewStore.getState().state.kind === 'idle' &&
    useLaserStore.getState().controllerSessionEpoch === approved.controllerSessionEpoch
  );
}

// A verified laser, or one whose power scale the operator has recorded as
// checked (ADR-237 Amendment 4): neither shows anything to confirm.
function reviewAsksNothing(acknowledgement: JobReviewModel['acknowledgement']): boolean {
  return (
    acknowledgement.kind === 'laser-verified' || acknowledgement.kind === 'laser-operator-stated'
  );
}

function carriedOverRecord(
  review: ConfirmedJobReview,
  receipt: LastCompletedReceipt,
  approved: SessionReviewedRun,
): ReviewCarriedOverV2 | null {
  const evidence = review.laserModeStartEvidence;
  if (evidence === undefined || evidence.unverifiedAcknowledged) return null;
  if (review.cncSetupAttestation !== undefined) return null;
  if (review.bundle.laser.controllerSessionEpoch !== approved.controllerSessionEpoch) return null;
  if (!reviewNeedsNoClick(review.reviewModel, 'start', approved)) return null;
  return {
    fromRunId: receipt.runId,
    operatorReviewedRunId: approved.operatorReviewedRunId,
    operatorReviewedAtIso: approved.operatorReviewedAtIso,
  };
}

function sameWarningSet(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  const expected = new Set(right);
  const shown = new Set(left);
  return shown.size === expected.size && [...shown].every((warning) => expected.has(warning));
}

// Confirms once, as the operator's earlier click. If the gate does not accept
// that (the job re-prepared differently, or a blocker appeared), it asks again
// and is told to close; the caller then opens the real dialog.
function standInPresentation(): JobReviewPresentation {
  let confirmed = false;
  return {
    requestOwner: Symbol('run-again-carried-review'),
    signal: new AbortController().signal,
    nextSignal: () => {
      if (confirmed) return Promise.resolve('cancel');
      confirmed = true;
      return Promise.resolve('confirm');
    },
    beginPrepare: () => undefined,
    completePrepare: () => undefined,
    failPrepare: () => undefined,
    confirm: () => undefined,
    close: () => undefined,
    dispose: () => undefined,
  };
}

/** What this session remembers of a review, so a later Run again of the run it
 * starts can carry it. Absent the run id, which exists only at the handoff. */
export type RunAgainReviewSeed = Omit<SessionReviewedRun, 'runId' | 'operatorReviewedRunId'> & {
  readonly operatorReviewedRunId?: string;
};

/** Null for a review Run again never carries: CNC, a remote approval, and a
 * tool-owned permit. */
export function runAgainReviewSeed(args: {
  readonly permit: FramedRunPermit;
  readonly review: FramedRunReviewEvidence;
  readonly controllerSessionEpoch: number;
  readonly options: FramedStartOptions;
}): RunAgainReviewSeed | null {
  if (!isOrdinaryDesktopReview(args.permit, args.options)) return null;
  if (args.review.reviewModel.machineKind !== 'laser') return null;
  const carried = args.review.carriedOver;
  return {
    controllerSessionEpoch: args.controllerSessionEpoch,
    warnings: args.review.reviewModel.warnings,
    operatorReviewedAtIso: carried?.operatorReviewedAtIso ?? args.review.reviewedAtIso,
    ...(carried === undefined ? {} : { operatorReviewedRunId: carried.operatorReviewedRunId }),
  };
}

export function noteRunAgainReview(runId: string, seed: RunAgainReviewSeed): void {
  noteSessionReviewedRun({
    runId,
    controllerSessionEpoch: seed.controllerSessionEpoch,
    warnings: seed.warnings,
    operatorReviewedRunId: seed.operatorReviewedRunId ?? runId,
    operatorReviewedAtIso: seed.operatorReviewedAtIso,
  });
}

export function carriedReviewNotice(warnings: ReadonlyArray<string>): string {
  if (warnings.length === 0) return 'Running the same reviewed job again.';
  const count = warnings.length === 1 ? 'warning' : `${warnings.length} warnings`;
  return `Running the same reviewed job again, with the same ${count} you accepted in Job Review.`;
}

/** Says, once the controller has the job, that no dialog was shown. The
 * accepted warnings fold under the line for anyone who wants to read them. */
export function announceCarriedReview(warnings: ReadonlyArray<string>): void {
  useToastStore.getState().pushToast(carriedReviewNotice(warnings), 'info', {
    key: RUN_AGAIN_CARRIED_REVIEW_TOAST_KEY,
    details: warnings,
  });
}
