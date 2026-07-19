import type { StatusReport } from '../../core/controllers/grbl';
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

/** The exact executable bundle prepared and reviewed before a physical Frame. */
export type PreparedStartProgram = {
  readonly ok: true;
  readonly gcode: string;
  readonly warnings: ReadonlyArray<string>;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly canvasPlan: CanvasMotionPlan;
  readonly prepared: Extract<PreparedOutput, { readonly ok: true }>;
  readonly preflightMotionOffset?: PreflightOptions['motionOffset'];
  readonly jobOrigin?: JobOriginPlacement;
};

export type FramedRunExternalEnvironment = {
  readonly cameraPlacementActive: boolean;
  readonly cameraConfirmedPositionEpoch: number | null;
  readonly cameraSurfaceHeightMm: number;
  readonly rotaryRasterAllowed: boolean;
};

/** Immutable reviewed input carried by the Frame motion until physical completion. */
export type FramedRunCandidate = {
  readonly preparedStart: PreparedStartProgram;
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly executionSignature: string;
  /** Bounds/origin compatibility proof retained during the Frame-first
   * migration. It becomes visible only with the completion-issued permit. */
  readonly frameVerification: FrameVerification;
  /** Reviewed controller/setup identity captured immediately before dispatch. */
  readonly controllerBeforeFrame: FramedRunControllerSnapshot;
  readonly externalEnvironment: FramedRunExternalEnvironment;
  /** Work-coordinate point occupied while this exact program was prepared.
   * Frame appends a tool-off return leg so Start begins from that same point. */
  readonly returnToWorkPosition: { readonly x: number; readonly y: number };
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly cncSetupAttestation?: CncSetupAttestation;
};

export type FramedRunControllerSnapshot = {
  readonly controllerSessionEpoch: number;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerSettingsObservation: SessionObservationStamp | null;
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

export function framedRunControllerSnapshot(
  source: FramedRunControllerSource,
): FramedRunControllerSnapshot {
  return {
    controllerSessionEpoch: source.controllerSessionEpoch,
    controllerSettings: source.controllerSettings,
    controllerSettingsObservation: source.controllerSettingsObservation,
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

export function framedRunCompletionIssue(
  candidate: FramedRunCandidate,
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

function sameControllerSetup(
  before: FramedRunControllerSnapshot,
  completed: FramedRunControllerSnapshot,
): boolean {
  return (
    before.controllerSessionEpoch === completed.controllerSessionEpoch &&
    before.controllerSettings === completed.controllerSettings &&
    before.controllerSettingsObservation === completed.controllerSettingsObservation &&
    sameAxes(before.wcoCache, completed.wcoCache) &&
    before.workOriginActive === completed.workOriginActive &&
    before.workOriginSource === completed.workOriginSource &&
    before.trustedPositionEpoch === completed.trustedPositionEpoch &&
    before.workZReferenceEpoch === completed.workZReferenceEpoch &&
    before.workZZeroEvidence === completed.workZZeroEvidence
  );
}

function sameReportedWorkPosition(
  before: FramedRunControllerSnapshot,
  completed: FramedRunControllerSnapshot,
): boolean {
  const left = reportedWorkPosition(before);
  const right = reportedWorkPosition(completed);
  return left !== null && right !== null && sameAxesWithinTolerance(left, right);
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
