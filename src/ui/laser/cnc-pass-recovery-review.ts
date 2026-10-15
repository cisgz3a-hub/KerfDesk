// Operator review for pass-boundary CNC recovery (ADR-215): the load-bearing
// physical confirmations, the position-evidence path, and the confirmation
// copy. Validation here checks OPERATOR INPUT for the new flow; it gates
// nothing that was previously available.

import type { CncPassResumeJob } from '../../core/recovery/cnc-pass-resume-job';
import type { CncResumePoint } from '../../core/recovery/cnc-resume-point';
import { reportedWorkOffsetMm } from '../state/infer-machine-position';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import type { RecoveryCapsule } from '../state/recovery';

// Compare physical millimetres, including when the archived and live $13
// report units differ. A raw inch difference would widen this tolerance 25.4x.
export const RETAINED_WCO_TOLERANCE_MM = 0.005;

export type CncPassRecoveryPositionEvidence =
  // Session-continuous incident: the controller was never observed to reboot
  // and the live work offset matches the archived observation. The operator
  // confirms nothing was moved instead of re-zeroing (ADR-215 decision 2).
  | { readonly kind: 'retained-confirmed' }
  // Position was (or may have been) lost; the operator re-established the
  // XY/Z zero before starting recovery.
  | { readonly kind: 're-zeroed' };

export type CncPassRecoveryReview = {
  readonly cutterClear: boolean;
  readonly spindleStopped: boolean;
  readonly workholdingConfirmed: boolean;
  readonly toolConfirmed: boolean;
  readonly position: CncPassRecoveryPositionEvidence;
  readonly groupIndex: number;
  readonly passIndex: number;
};

/** Wizard draft of the review. Position evidence starts unselected (null) and
 * must be an explicit operator choice: a pre-selected default would let
 * recovery motion start without any position attestation. */
export type CncPassRecoveryChecklistDraft = Omit<
  CncPassRecoveryReview,
  'groupIndex' | 'passIndex' | 'position'
> & { readonly position: CncPassRecoveryPositionEvidence | null };

export function cncPassRecoveryReviewIssue(review: CncPassRecoveryReview): string | null {
  if (!review.cutterClear) return 'Confirm that the cutter is physically clear before any motion.';
  if (!review.spindleStopped) return 'Confirm that the spindle is physically stopped.';
  if (!review.workholdingConfirmed) {
    return 'Confirm that stock and workholding are unchanged and secure.';
  }
  if (!review.toolConfirmed) {
    return 'Confirm that the required tool is installed, intact, and Z-zeroed.';
  }
  return null;
}

/** Why the retained-position path is not available, or null when the
 * session-continuity evidence supports it. */
export function retainedPositionIssue(
  capsule: RecoveryCapsule,
  liveWco: WorkCoordinateOffset | null,
  liveReportInches?: boolean,
): string | null {
  if (capsule.interruption.kind === 'controller-reboot') {
    return 'The controller rebooted during the incident, so its position cannot be retained. Re-establish the XY/Z zero, then choose the re-zeroed option.';
  }
  // The work offset survives a reset that killed the steppers mid-motion, so a
  // matching offset proves nothing about steps the motors never took
  // (ADR-215 Amendment 1).
  if (capsule.interruption.positionLost === true) {
    return 'The machine was stopped while it may still have been moving, so the motors may have lost steps and the position cannot be retained. Re-home the machine, re-establish the XY/Z zero, then choose the re-zeroed option.';
  }
  const archivedWco =
    capsule.artifact.kind === 'exact-execution'
      ? capsule.artifact.archivedControllerObservation.wco
      : undefined;
  if (archivedWco === undefined || archivedWco === null) {
    return 'The interrupted run has no archived work-offset observation to compare against. Re-establish the XY/Z zero, then choose the re-zeroed option.';
  }
  if (liveWco === null) {
    return 'The live controller has not reported its work offset yet. Wait for a status report, or re-establish the XY/Z zero.';
  }
  const archivedReportInches =
    capsule.artifact.kind === 'exact-execution'
      ? capsule.artifact.archivedControllerObservation.settings?.reportInches
      : undefined;
  return retainedWorkOffsetIssue(archivedWco, archivedReportInches, liveWco, liveReportInches);
}

function retainedWorkOffsetIssue(
  archivedWco: WorkCoordinateOffset,
  archivedReportInches: boolean | undefined,
  liveWco: WorkCoordinateOffset,
  liveReportInches: boolean | undefined,
): string | null {
  if (archivedReportInches === undefined || liveReportInches === undefined) {
    return 'The archived or live position-report units are unconfirmed, so retained position cannot be compared. Re-establish the XY/Z zero, then choose the re-zeroed option.';
  }
  const archivedWcoMm = reportedWorkOffsetMm(archivedWco, archivedReportInches);
  const liveWcoMm = reportedWorkOffsetMm(liveWco, liveReportInches);
  if (archivedWcoMm === null || liveWcoMm === null || !wcoMatches(archivedWcoMm, liveWcoMm)) {
    return 'The live work offset differs from the offset archived with the interrupted run, so retained position cannot be confirmed. Re-establish the XY/Z zero, then choose the re-zeroed option.';
  }
  return null;
}

function wcoMatches(a: WorkCoordinateOffset, b: WorkCoordinateOffset): boolean {
  return (
    Math.abs(a.x - b.x) <= RETAINED_WCO_TOLERANCE_MM &&
    Math.abs(a.y - b.y) <= RETAINED_WCO_TOLERANCE_MM &&
    Math.abs(a.z - b.z) <= RETAINED_WCO_TOLERANCE_MM
  );
}

/** True when the operator picked a pass after the computed default — allowed,
 * but it may skip uncut material, so the flow warns first (never blocks). */
export function isLaterThanDefault(
  review: Pick<CncPassRecoveryReview, 'groupIndex' | 'passIndex'>,
  resumePoint: CncResumePoint | null,
): boolean {
  if (resumePoint === null || resumePoint.kind !== 'resume-at-pass') return false;
  if (review.groupIndex !== resumePoint.groupIndex) {
    return review.groupIndex > resumePoint.groupIndex;
  }
  return review.passIndex > resumePoint.passIndex;
}

export function latePickWarning(resumePoint: Extract<CncResumePoint, { kind: 'resume-at-pass' }>) {
  return (
    'START LATER THAN THE COMPUTED SAFE PASS?\n\n' +
    `The computed recovery boundary is operation ${resumePoint.groupIndex + 1}, ` +
    `pass ${resumePoint.passIndex + 1}. It is a conservative estimate from controller acknowledgements ` +
    'and buffer capacity, not proof of the physical cut. Starting at a later pass skips everything before it — any ' +
    'uncut material in that range stays uncut.\n\n' +
    'Continue only if you physically verified all earlier passes are complete.'
  );
}

export function passRecoveryConfirmation(
  review: CncPassRecoveryReview,
  resume: CncPassResumeJob,
  motion: { readonly spindleRpm: number; readonly spindleSpinupSec: number },
): string {
  return (
    'START CNC PASS RECOVERY?\n\n' +
    `Boundary: operation ${review.groupIndex + 1}, pass ${review.passIndex + 1}\n` +
    `Omitted as already complete: ${resume.omittedPassCount} of ${resume.totalPassCount} passes\n` +
    `Spindle: ${motion.spindleRpm} rpm with ${motion.spindleSpinupSec} s spin-up dwell at safe Z\n\n` +
    'The machine will retract to safe Z, start and dwell the spindle, rapid to the boundary ' +
    "pass's start, plunge at plunge feed, and recut that pass from its beginning before " +
    'continuing with all later work. Expect light recutting of already-cleared kerf.\n\n' +
    'Every omitted pass must already be physically complete. Keep the physical E-stop reachable ' +
    'and supervise the entire re-entry.'
  );
}
