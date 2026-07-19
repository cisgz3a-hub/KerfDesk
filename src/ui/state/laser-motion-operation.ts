import type { GrblState } from '../../core/controllers/grbl';
import type { FrameVerification } from './frame-verification';
import type { FramedRunCandidate } from './framed-run';

export type LaserMotionOperationKind = 'frame' | 'jog';
export type LaserMotionOperationId = number | symbol;

type LaserMotionOperationCommon = {
  /** Stable owner for every async transport/ack continuation belonging to one
   * physical motion operation. Carried unchanged across all Frame legs. */
  readonly operationId: LaserMotionOperationId;
  readonly sawControllerBusy: boolean;
  readonly idleStatusReports: number;
  readonly dispatchComplete: boolean;
  readonly pendingLines: ReadonlyArray<string>;
  /** Compatibility payload for the pre-permit Frame proof. It follows the
   * same owned settlement lifecycle, but can promote only frameVerification;
   * the richer candidate below is the sole source of a one-use Start permit. */
  readonly verification?: FrameVerification;
  /** Number of leading lines, including the one currently dispatched, whose
   * acknowledgement advances directly to the next line without waiting for a
   * motion status transition. Frame uses this for its instantaneous tool-off
   * prelude. Optional for legacy/test snapshots; absence means zero. */
  readonly acknowledgedPrefixLinesRemaining?: number;
  /** Motion-action writes whose adapter promise has not settled. Kept on the
   * operation (not the global queue) so status-poll transport cannot fence
   * Frame/Jog against its own early reply. */
  readonly pendingMotionTransportWrites?: number;
  /** Driver-owned planner-drain marker appended after the final Frame motion. */
  readonly settlementLine?: string;
  /** True once that final marker is dispatched; no completion is legal until
   * its exact FIFO ack stamps a later status boundary. */
  readonly awaitingSettlementAck?: boolean;
  readonly settlementAckStatusSequence?: number;
  /** Set before a realtime cancel is dispatched. A cancelled Frame may still
   * own late transport/status evidence, but it can never dispatch another leg
   * or mint a Start permit. */
  readonly cancelRequested?: boolean;
  /** Status sequence captured after cancel transport, the old motion queue,
   * and an ack-owned planner-settlement marker all complete, immediately
   * before a new status query. Only a later Idle may release the owner. */
  readonly cancelStatusQueryAfterSequence?: number;
};

export type LaserMotionOperation = LaserMotionOperationCommon &
  ({ readonly kind: 'jog' } | { readonly kind: 'frame'; readonly candidate?: FramedRunCandidate });

export function startMotionOperation(
  kind: LaserMotionOperationKind,
  pendingLines: ReadonlyArray<string> = [],
  candidate?: FramedRunCandidate,
  acknowledgedPrefixLinesRemaining = 0,
  pendingMotionTransportWrites = 0,
  operationId: LaserMotionOperationId = Symbol('motion-operation'),
  settlementLine?: string,
  verification?: FrameVerification,
): LaserMotionOperation {
  const common = {
    operationId,
    sawControllerBusy: false,
    idleStatusReports: 0,
    dispatchComplete: false,
    pendingLines,
    acknowledgedPrefixLinesRemaining,
    pendingMotionTransportWrites,
    ...(settlementLine === undefined ? {} : { settlementLine }),
    ...(verification === undefined ? {} : { verification }),
  };
  if (kind === 'jog') return { kind, ...common };
  return candidate === undefined ? { kind, ...common } : { kind, ...common, candidate };
}

export function markMotionOperationDispatched(
  operation: LaserMotionOperation | null,
  kind: LaserMotionOperationKind,
  operationId: LaserMotionOperationId,
): LaserMotionOperation | null {
  if (operation === null || operation.kind !== kind || operation.operationId !== operationId) {
    return operation;
  }
  return { ...operation, dispatchComplete: true };
}

export function observeMotionStatus(
  operation: LaserMotionOperation | null,
  state: GrblState,
  nextStatusSequence?: number,
): LaserMotionOperation | null {
  if (operation === null) return null;
  if (operation.cancelRequested === true)
    return observeCancelledMotionStatus(operation, state, nextStatusSequence);
  if (operation.awaitingSettlementAck === true)
    return observeSettlementStatus(operation, state, nextStatusSequence);
  return observeActiveMotionStatus(operation, state);
}

function observeCancelledMotionStatus(
  operation: LaserMotionOperation,
  state: GrblState,
  nextStatusSequence: number | undefined,
): LaserMotionOperation | null {
  const queriedAfter = operation.cancelStatusQueryAfterSequence;
  return state === 'Idle' &&
    queriedAfter !== undefined &&
    nextStatusSequence !== undefined &&
    nextStatusSequence > queriedAfter
    ? null
    : operation;
}

function observeSettlementStatus(
  operation: LaserMotionOperation,
  state: GrblState,
  nextStatusSequence: number | undefined,
): LaserMotionOperation | null {
  const acknowledgedAfter = operation.settlementAckStatusSequence;
  if (
    acknowledgedAfter === undefined ||
    nextStatusSequence === undefined ||
    nextStatusSequence <= acknowledgedAfter
  ) {
    return operation;
  }
  return state === 'Idle' ? null : { ...operation, sawControllerBusy: true, idleStatusReports: 0 };
}

function observeActiveMotionStatus(
  operation: LaserMotionOperation,
  state: GrblState,
): LaserMotionOperation | null {
  if (state === 'Idle' && !operation.dispatchComplete) return operation;
  if (state === 'Idle' && operation.sawControllerBusy) return null;
  if (state === 'Idle') {
    const idleStatusReports = operation.idleStatusReports + 1;
    return idleStatusReports >= 2 ? null : { ...operation, idleStatusReports };
  }
  if (!operation.sawControllerBusy || operation.idleStatusReports !== 0) {
    return { ...operation, sawControllerBusy: true, idleStatusReports: 0 };
  }
  return operation;
}

/** A physical Idle is provisional until the just-dispatched motion line's
 * transport handoff and terminal response settle. Keeping ownership prevents
 * the next line (including the planner marker) from outrunning a delayed
 * rejection, and prevents an old Jog ack from being mistaken for that marker. */
export function applyMotionTerminalAckFence(
  operation: LaserMotionOperation | null,
  observed: LaserMotionOperation | null,
  pendingUntrackedAcks: number,
): LaserMotionOperation | null {
  if (observed !== null || operation === null) return observed;
  // A cancelled operation receives its query stamp only after the old motion
  // queue and the driver's ack-owned settle marker drain. Therefore this
  // post-stamp Idle proves physical settlement; any remaining counters belong
  // to the confirming status query itself and must not self-fence its evidence.
  if (operation.cancelRequested === true) return null;
  if ((operation.acknowledgedPrefixLinesRemaining ?? 0) > 0) {
    return operation;
  }
  // No later motion line and no completion permit may outrun either half of the
  // current line's handoff. A fast controller can acknowledge and report Idle
  // before the adapter's write promise settles; conversely Idle can arrive
  // before the terminal response. Keep the exact candidate owned until both
  // transport acceptance and the ordered response ledger are settled.
  if (pendingUntrackedAcks > 0 || (operation.pendingMotionTransportWrites ?? 0) > 0) {
    return operation;
  }
  return observed;
}

/** Advance the driver-owned tool-off prefix on its terminal `ok`. These lines
 * are non-motion commands, so their own acknowledgement is the completion
 * signal; the first physical Frame move is not written until the whole prefix
 * has acknowledged in order. */
export function takeNextAcknowledgedFramePrefixLine(
  operation: LaserMotionOperation | null,
): { readonly operation: LaserMotionOperation; readonly line: string } | null {
  if (operation === null || operation.kind !== 'frame' || operation.cancelRequested === true) {
    return null;
  }
  const remaining = operation.acknowledgedPrefixLinesRemaining ?? 0;
  if (remaining <= 0) return null;
  const [line, ...pendingLines] = operation.pendingLines;
  if (line === undefined) return null;
  return {
    operation: startMotionOperation(
      'frame',
      pendingLines,
      operation.candidate,
      Math.max(0, remaining - 1),
      operation.pendingMotionTransportWrites ?? 0,
      operation.operationId,
      operation.settlementLine,
      operation.verification,
    ),
    line,
  };
}

export function takeNextMotionLine(
  operation: LaserMotionOperation | null,
): { readonly operation: LaserMotionOperation; readonly line: string } | null {
  if (operation === null || operation.cancelRequested === true) {
    return null;
  }
  const [line, ...pendingLines] = operation.pendingLines ?? [];
  if (line === undefined) return null;
  const nextOperation = startMotionOperation(
    operation.kind,
    pendingLines,
    operation.kind === 'frame' ? operation.candidate : undefined,
    operation.acknowledgedPrefixLinesRemaining ?? 0,
    operation.pendingMotionTransportWrites ?? 0,
    operation.operationId,
    operation.settlementLine,
    operation.verification,
  );
  const dispatchesSettlement =
    pendingLines.length === 0 && operation.settlementLine !== undefined
      ? line === operation.settlementLine
      : false;
  return {
    operation: dispatchesSettlement
      ? { ...nextOperation, awaitingSettlementAck: true }
      : nextOperation,
    line,
  };
}

export function acknowledgeMotionSettlementMarker(
  operation: LaserMotionOperation | null,
  operationId: LaserMotionOperationId,
  statusSequence: number,
): LaserMotionOperation | null {
  if (
    operation === null ||
    operation.operationId !== operationId ||
    operation.awaitingSettlementAck !== true ||
    operation.settlementAckStatusSequence !== undefined
  ) {
    return operation;
  }
  return {
    ...operation,
    sawControllerBusy: false,
    idleStatusReports: 0,
    settlementAckStatusSequence: statusSequence,
  };
}

// Frame move construction moved to the ControllerDriver (ADR-094):
// core/controllers/grbl/frame-lines.ts owns the GRBL $J= perimeter builder.
