import type { StatusReport } from '../../core/controllers/grbl';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import type { ControllerSettingsSnapshot, PreflightOptions } from '../../core/preflight';
import type { OutputScope, Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import type { CncSetupAttestation } from './cnc-setup-attestation';
import type { CncToolPlanEntry } from './cnc-tool-plan';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import type { SessionObservationStamp } from './laser-controller-observation';
import type { LaserModeStartEvidence } from './laser-mode-start-evidence';
import type { WorkCoordinateOffset } from './origin-actions';
import type { WorkZZeroEvidence } from './work-z-zero-evidence';
import type { JobOriginPlacement } from '../../core/job';
import type { FrameVerification } from './frame-verification';
import type { JobReviewModel } from '../laser/job-review/job-review-model';
import type { PreparedJobMetrics } from '../laser/prepared-job-metrics';
import type { ControllerKind } from '../../core/devices';
import type { CanvasJobTimingPlanResult } from './canvas-job-timing-plan';
import type { LaserSecondPassChain } from './recovery/laser-second-pass-lineage';

/** The exact executable bundle carried through Frame. Ordinary permits review
 * it at Start; transient-camera candidates may carry prior review evidence. */
export type PreparedStartProgram = {
  readonly ok: true;
  readonly gcode: string;
  readonly warnings: ReadonlyArray<string>;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly canvasPlan: CanvasMotionPlan;
  readonly jobTimingPlan?: CanvasJobTimingPlanResult;
  readonly metrics: PreparedJobMetrics;
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  readonly jobOrigin?: JobOriginPlacement;
  readonly laserSecondPassChain?: LaserSecondPassChain;
};

/** Review evidence confirmed in the Job Review dialog. An ordinary Frame
 * issues a review-pending permit and Start opens the single Job Review
 * (ADR-237); a transient camera Frame is reviewed before dispatch and
 * carries its evidence from birth. */
export type FramedRunReviewEvidence = {
  readonly reviewedAtIso: string;
  readonly reviewModel: JobReviewModel;
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly cncSetupAttestation?: CncSetupAttestation;
};

/** Immutable exact prepared input carried by the Frame motion until physical completion. */
export type FramedRunCandidate = {
  readonly preparedStart: PreparedStartProgram;
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly executionSignature: string;
  /** Bounds/origin compatibility proof retained during the Frame-first
   * migration. It becomes visible only with the completion-issued permit. */
  readonly frameVerification: FrameVerification;
  /** Controller/setup identity captured immediately before Frame dispatch and
   * interpreted by the later Start-time review for an ordinary permit. */
  readonly controllerBeforeFrame: FramedRunControllerSnapshot;
  /** Work-coordinate point occupied while this exact program was prepared.
   * Frame appends a tool-off return leg so Start begins from that same point. */
  readonly returnToWorkPosition: { readonly x: number; readonly y: number };
  /** Present only when Job Review preceded Frame (transient camera). Absent
   * on ordinary permits: Start owns the one review before claiming them. */
  readonly review?: FramedRunReviewEvidence;
  /** Durable disclosure for the owned pre-Frame G54 selection, surfaced in
   * Start's Job Review for a review-pending permit. */
  readonly frameWcsNormalizationWarning?: string;
  /** Transient calibration jobs own immutable prepared bytes outside the open
   * canvas. Their permit must follow that project rather than the unrelated
   * live-project execution signature. */
  readonly authorizationContext?: 'transient-camera' | 'laser-second-pass';
};

/** The candidate a split Frame traces before its exact program exists: every
 * FramedRunCandidate field except the program and review evidence. The trace
 * runs against the compiled job's bounds while the exact preparation finishes
 * off-thread; a permit is minted only when that program arrives with the same
 * bounds (ADR-353). The marker keeps it from ever being read as a permit
 * candidate. */
export type FrameTraceCandidate = Omit<FramedRunCandidate, 'preparedStart' | 'review'> & {
  readonly exactProgram: 'deferred';
};

/** What a Frame motion may carry: an exact candidate, which completion turns
 * into a permit, or a trace candidate, which completion records as a trace. */
export type FrameMotionCandidate = FramedRunCandidate | FrameTraceCandidate;

/** Only a candidate that declares its program deferred is a trace; the
 * marker is required on every trace candidate, so the exact path never has
 * to prove a negative. */
export function isFramedRunCandidate(
  candidate: FrameMotionCandidate,
): candidate is FramedRunCandidate {
  return !('exactProgram' in candidate && candidate.exactProgram === 'deferred');
}

/** Completion-issued record of a clean trace whose exact program was still
 * being prepared. Never a Start authorization by itself: the Frame flow binds
 * the exact program to it with `mintDeferredFramedRunPermit`, or it expires
 * under the same drift rules as a permit. */
export type FrameTrace = {
  readonly kind: 'traced';
  readonly candidate: FrameTraceCandidate;
  readonly completedStatusSequence: number;
  readonly controller: FramedRunControllerSnapshot;
};

/** The shape readiness and expiry compare, shared by a permit and a trace. */
export type FramedRunEvidence = {
  readonly candidate: FrameMotionCandidate;
  readonly completedStatusSequence: number;
  readonly controller: FramedRunControllerSnapshot;
};

export type FramedRunControllerSnapshot = {
  readonly controllerSessionEpoch: number;
  /** Review/provenance evidence only. Frame remains the sole ordinary Start
   * guard; identity disagreement is disclosed in Job Review, not refused. */
  readonly activeControllerKind: ControllerKind;
  readonly detectedControllerKind: ControllerKind | null;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerSettingsObservation: SessionObservationStamp | null;
  readonly controllerBuildInfo: GrblBuildInfo | null;
  readonly controllerBuildInfoObservation: SessionObservationStamp | null;
  readonly statusReport: StatusReport | null;
  readonly wcoCache: WorkCoordinateOffset | null;
  readonly workOriginActive: boolean;
  readonly workOriginSource: 'none' | 'g92' | 'g54-persistent' | 'unknown';
  readonly trustedPositionEpoch: number;
  readonly workZReferenceEpoch: number;
  readonly workZZeroEvidence: WorkZZeroEvidence | null;
};

export type FramedRunControllerSource = Omit<
  FramedRunControllerSnapshot,
  'trustedPositionEpoch'
> & {
  readonly trustedPositionEpoch?: number;
  readonly statusSequence: number;
};

/** Completion-issued authorization for one exact prepared program. */
export type FramedRunPermit = {
  readonly kind: 'ready';
  readonly candidate: FramedRunCandidate;
  readonly completedStatusSequence: number;
  readonly controller: FramedRunControllerSnapshot;
};

/** One synchronous owner for an exact permit crossing the final Start handoff. */
export type FramedRunStartClaim = {
  readonly permit: FramedRunPermit;
};

export const FRAME_CONTROLLER_CHANGED_MESSAGE =
  'Controller or machine setup changed during Frame. No Start permit was issued; review the setup and Frame again.';
export const FRAME_RETURN_POSITION_CHANGED_MESSAGE =
  'The machine did not return to its pre-Frame work position. No Start permit was issued; inspect the machine and Frame again.';
export const FRAME_START_SESSION_CHANGED_MESSAGE =
  'The controller session changed after Frame. Frame the exact job again before starting.';
export const FRAME_START_ORIGIN_CHANGED_MESSAGE =
  'The work origin changed after Frame. Frame the exact job again before starting.';
export const FRAME_START_REPORT_UNITS_CHANGED_MESSAGE =
  'The controller position report units changed after Frame. Frame the exact job again before starting.';
export const FRAME_START_POSITION_CHANGED_MESSAGE =
  'The machine moved after Frame. Return to the framed work position or Frame the exact job again before starting.';

export function framedRunControllerSnapshot(
  source: FramedRunControllerSource,
): FramedRunControllerSnapshot {
  return {
    controllerSessionEpoch: source.controllerSessionEpoch,
    activeControllerKind: source.activeControllerKind,
    detectedControllerKind: source.detectedControllerKind,
    controllerSettings: source.controllerSettings,
    controllerSettingsObservation: source.controllerSettingsObservation,
    controllerBuildInfo: source.controllerBuildInfo,
    controllerBuildInfoObservation: source.controllerBuildInfoObservation,
    statusReport: source.statusReport,
    wcoCache: source.wcoCache,
    workOriginActive: source.workOriginActive,
    workOriginSource: source.workOriginSource,
    trustedPositionEpoch: source.trustedPositionEpoch ?? 0,
    workZReferenceEpoch: source.workZReferenceEpoch,
    workZZeroEvidence: source.workZZeroEvidence,
  };
}

export function createFramedRunPermit(
  candidate: FramedRunCandidate,
  source: FramedRunControllerSource,
): FramedRunPermit {
  return {
    kind: 'ready',
    candidate,
    completedStatusSequence: source.statusSequence,
    controller: framedRunControllerSnapshot(source),
  };
}

export function createFrameTrace(
  candidate: FrameTraceCandidate,
  source: FramedRunControllerSource,
): FrameTrace {
  return {
    kind: 'traced',
    candidate,
    completedStatusSequence: source.statusSequence,
    controller: framedRunControllerSnapshot(source),
  };
}

/** Bind the exact program to a completed trace. The caller has already proved
 * that the program's frame bounds equal the traced ones and that nothing
 * drifted since completion; this only assembles the permit from the trace's
 * own completion evidence, so the permit reads exactly like one minted at the
 * clean Idle of an ordinary Frame (ADR-353). */
export function mintDeferredFramedRunPermit(
  trace: FrameTrace,
  preparedStart: PreparedStartProgram,
): FramedRunPermit {
  const { exactProgram, ...candidate } = trace.candidate;
  void exactProgram;
  return {
    kind: 'ready',
    candidate: { ...candidate, preparedStart },
    completedStatusSequence: trace.completedStatusSequence,
    controller: trace.controller,
  };
}

export function framedRunCompletionIssue(
  candidate: FrameMotionCandidate,
  source: FramedRunControllerSource,
): string | null {
  const completed = framedRunControllerSnapshot(source);
  if (!sameControllerSetup(candidate.controllerBeforeFrame, completed)) {
    return FRAME_CONTROLLER_CHANGED_MESSAGE;
  }
  if (!sameReportedWorkPosition(candidate.controllerBeforeFrame, completed)) {
    return FRAME_RETURN_POSITION_CHANGED_MESSAGE;
  }
  return null;
}

/** Final wire-boundary comparison for an ordinary Start. Advisory controller
 * settings are intentionally excluded; only session, origin identity, and the
 * freshly reported work position bind the completed Frame to these bytes. */
export function framedRunStartHandoffIssue(
  permit: FramedRunPermit,
  source: FramedRunControllerSource,
): string | null {
  const current = framedRunControllerSnapshot(source);
  if (current.controllerSessionEpoch !== permit.controller.controllerSessionEpoch) {
    return FRAME_START_SESSION_CHANGED_MESSAGE;
  }
  if (
    (current.controllerSettings?.reportInches === true) !==
    (permit.controller.controllerSettings?.reportInches === true)
  )
    return FRAME_START_REPORT_UNITS_CHANGED_MESSAGE;
  if (!sameStartOrigin(permit.controller, current)) return FRAME_START_ORIGIN_CHANGED_MESSAGE;
  if (!sameReportedWorkPosition(permit.controller, current)) {
    return FRAME_START_POSITION_CHANGED_MESSAGE;
  }
  return null;
}

function sameControllerSetup(
  before: FramedRunControllerSnapshot,
  completed: FramedRunControllerSnapshot,
): boolean {
  return (
    before.controllerSessionEpoch === completed.controllerSessionEpoch &&
    // Refreshed settings/build-info objects and observation stamps are review
    // evidence, not movement. Keep the report-unit interpretation bound even
    // at zero, where normalized coordinates alone cannot reveal a unit change.
    (before.controllerSettings?.reportInches === true) ===
      (completed.controllerSettings?.reportInches === true) &&
    sameAxes(before.wcoCache, completed.wcoCache) &&
    before.workOriginActive === completed.workOriginActive &&
    before.workOriginSource === completed.workOriginSource &&
    before.trustedPositionEpoch === completed.trustedPositionEpoch &&
    before.workZReferenceEpoch === completed.workZReferenceEpoch &&
    before.workZZeroEvidence === completed.workZZeroEvidence
  );
}

function sameStartOrigin(
  framed: FramedRunControllerSnapshot,
  current: FramedRunControllerSnapshot,
): boolean {
  return (
    sameAxes(framed.wcoCache, current.wcoCache) &&
    framed.workOriginActive === current.workOriginActive &&
    framed.workOriginSource === current.workOriginSource &&
    framed.trustedPositionEpoch === current.trustedPositionEpoch
  );
}

function sameReportedWorkPosition(
  before: FramedRunControllerSnapshot,
  completed: FramedRunControllerSnapshot,
): boolean {
  const left = reportedWorkPosition(before);
  const right = reportedWorkPosition(completed);
  if (left === null || right === null) return false;
  if ((before.statusReport?.wPos === null) === (completed.statusReport?.wPos === null)) {
    return sameAxesWithinTolerance(left, right);
  }
  // An added WPos field must not hide movement in a directly shared MPos.
  if (!sameCommonMachinePosition(before, completed)) return false;
  const scale = before.controllerSettings?.reportInches === true ? 25.4 : 1;
  const tick = scale === 1 ? 0.001 : 0.0001 * scale;
  const offset = before.wcoCache;
  return (['x', 'y', 'z'] as const).every((axis) => {
    // Keep the existing direct-position tolerance on zero-offset axes. Only
    // subtracting separately rounded MPos/WCO can add a full reporting tick.
    if (offset === null || offset[axis] === 0) {
      return Math.abs(left[axis] - right[axis]) <= 1e-3;
    }
    const arithmeticError =
      Number.EPSILON *
      Math.max(1, Math.abs(left[axis]), Math.abs(right[axis]), Math.abs(offset[axis] * scale)) *
      4;
    return Math.abs(left[axis] - right[axis]) <= tick + arithmeticError;
  });
}

function sameCommonMachinePosition(
  before: FramedRunControllerSnapshot,
  completed: FramedRunControllerSnapshot,
): boolean {
  const left = before.statusReport?.mPos;
  const right = completed.statusReport?.mPos;
  if (left == null || right == null) return true;
  const scale = before.controllerSettings?.reportInches === true ? 25.4 : 1;
  return sameAxesWithinTolerance(scaledAxes(left, scale), scaledAxes(right, scale));
}

function reportedWorkPosition(
  snapshot: FramedRunControllerSnapshot,
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const report = snapshot.statusReport;
  if (report === null) return null;
  const scale = snapshot.controllerSettings?.reportInches === true ? 25.4 : 1;
  if (report.wPos !== null) return scaledAxes(report.wPos, scale);
  if (report.mPos === null) return null;
  if (snapshot.wcoCache === null && snapshot.workOriginActive) return null;
  const machine = scaledAxes(report.mPos, scale);
  const offset = scaledAxes(snapshot.wcoCache ?? { x: 0, y: 0, z: 0 }, scale);
  return { x: machine.x - offset.x, y: machine.y - offset.y, z: machine.z - offset.z };
}

function scaledAxes(
  axes: { readonly x: number; readonly y: number; readonly z: number },
  scale: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  return { x: axes.x * scale, y: axes.y * scale, z: axes.z * scale };
}

function sameAxes(left: WorkCoordinateOffset | null, right: WorkCoordinateOffset | null): boolean {
  if (left === null || right === null) return left === right;
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function sameAxesWithinTolerance(
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  const epsilon = 1e-3;
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.z - right.z) <= epsilon
  );
}
