import type { FrameTrace, FrameTraceCandidate } from '../state/framed-run';
import type { LaserMotionOperation, LaserMotionOperationId } from '../state/laser-motion-operation';
import type { LaserState } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { framedRunReadinessIssue } from './framed-run-readiness';

export type FramePreparationMotionOwner = {
  readonly claim: (candidate: FrameTraceCandidate) => void;
  readonly controllerForPreparation: (current: LaserState) => LaserState | null;
};

type MotionOwnership = {
  candidate: FrameTraceCandidate | null;
  operationId: LaserMotionOperationId | null;
  completed: FrameTrace | null;
};

/** Only this candidate's physical Frame may move while its exact program is
 * compiling. Keep its original placement inputs, but continue comparing live
 * session, origin, WCO, units, native-bed evidence and CNC Z references. */
export function ownFramePreparationMotion(before: LaserState): FramePreparationMotionOwner {
  const owner: MotionOwnership = { candidate: null, operationId: null, completed: null };
  return {
    claim: (owned) => {
      owner.candidate = owned;
    },
    controllerForPreparation: (current) => controllerForOwnedFrame(before, current, owner),
  };
}

function controllerForOwnedFrame(
  before: LaserState,
  current: LaserState,
  owner: MotionOwnership,
): LaserState | null {
  if (owner.candidate === null) return current;
  if (!frameSetupUnchanged(before, current)) return null;
  const operation = current.motionOperation;
  if (operation !== null) {
    if (!ownsUninterruptedFrame(operation, current, owner)) return null;
    owner.operationId = operation.operationId;
  } else {
    if (owner.operationId === null) return current; // Awaiting the first owned dispatch.
    if (!ownsCleanTrace(current, owner)) return null;
    owner.completed = current.frameTrace ?? null;
  }
  return { ...current, statusReport: before.statusReport };
}

function frameSetupUnchanged(before: LaserState, current: LaserState): boolean {
  return (
    current.alarmCode === null &&
    current.mpgActive !== true &&
    !current.autofocusBusy &&
    current.controllerOperation === null &&
    !isActiveJob(current.streamer) &&
    current.reportUnitsUnconfirmed !== true &&
    current.positionEvidenceSuppressed !== true &&
    current.activeWcs === before.activeWcs &&
    (current.controllerSettings?.reportInches === true) ===
      (before.controllerSettings?.reportInches === true)
  );
}

function ownsUninterruptedFrame(
  operation: LaserMotionOperation,
  current: LaserState,
  owner: MotionOwnership,
): boolean {
  return (
    operation.kind === 'frame' &&
    operation.candidate === owner.candidate &&
    operation.cancelRequested !== true &&
    operation.mpgInterruptionId === undefined &&
    operation.interruptedByMpg !== true &&
    owner.completed === null &&
    (owner.operationId === null || operation.operationId === owner.operationId) &&
    ['Idle', 'Jog', 'Run'].includes(current.statusReport?.state ?? '')
  );
}

function ownsCleanTrace(current: LaserState, owner: MotionOwnership): boolean {
  const trace = current.frameTrace ?? null;
  return (
    trace !== null &&
    trace.candidate === owner.candidate &&
    (owner.completed === null || trace === owner.completed) &&
    current.statusReport?.state === 'Idle' &&
    framedRunReadinessIssue(trace, undefined, current) === null
  );
}
