// step-jog-queue — later step presses join a running operator step jog
// (protocol audit P-3, ADR-648). Tapping an arrow three times quickly used to
// move one step: every jog proved a fresh Idle first, and the pad was disabled
// while any motion operation ran.
//
// A queued step is held by KerfDesk, not written to the controller at once.
// It waits in the jog operation's own pendingLines, ahead of the planner-drain
// marker, and is dispatched like a Frame leg: after the step before it reached
// Idle and its acknowledgement and transport settled. So no queued step can be
// in the controller's serial buffer when Cancel sends 0x85. Stock GRBL's 0x85
// empties only the planner and leaves received lines to run
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L162),
// while Cancel's cancelRequested stops every pending line here.

import type { LaserMotionOperation } from './laser-motion-operation';
import { isActiveJob } from './laser-store-helpers';
import type { LaserState } from './laser-store';

/** Steps one jog operation may owe at once, the running one included. */
export const MAX_STEP_JOGS_PER_OPERATION = 3;

/** Marks an operator step jog that later step presses may extend. */
export type StepJogQueue = {
  readonly sessionEpoch: number;
  /** Machine XY after every accepted step, for the warn-only bounds and
   *  no-go checks of the next one; null when the first start was unknown. */
  readonly plannedEnd: { readonly x: number; readonly y: number } | null;
};

/** The steps this operation still owes: those queued plus the one running.
 *  Once the planner-drain marker is out, no step is running. */
export function outstandingStepJogs(operation: LaserMotionOperation): number {
  const queued = operation.pendingLines.filter((line) => line !== operation.settlementLine).length;
  return queued + (operation.awaitingSettlementAck === true ? 0 : 1);
}

/** True when a step press may join the running step jog instead of being
 *  refused: a native-jog controller (GRBL family) with a jog-cancel byte, the
 *  same controller session, nothing else owning the machine, and room left. */
export function canQueueStepJog(state: LaserState): boolean {
  const operation = state.motionOperation;
  if (operation?.kind !== 'jog' || !ownsQueueableStepJog(state, operation)) return false;
  if (state.capabilities.jog !== 'native-jog' || !state.capabilities.jogCancel) return false;
  if (!machineFreeForQueuedStep(state)) return false;
  const reported = state.statusReport?.state;
  if (reported !== 'Idle' && reported !== 'Jog') return false;
  return outstandingStepJogs(operation) < MAX_STEP_JOGS_PER_OPERATION;
}

function ownsQueueableStepJog(state: LaserState, operation: LaserMotionOperation): boolean {
  return (
    operation.stepJogQueue?.sessionEpoch === state.controllerSessionEpoch &&
    operation.cancelRequested !== true &&
    operation.mpgInterruptionId === undefined &&
    operation.interruptedByMpg !== true &&
    operation.executionOwner === undefined
  );
}

function machineFreeForQueuedStep(state: LaserState): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.controllerOperation === null &&
    state.mpgActive !== true &&
    !state.autofocusBusy &&
    !state.fireActive &&
    !isActiveJob(state.streamer)
  );
}

/** The operation with one more step queued ahead of its planner-drain
 *  marker. A marker already dispatched is sent again after the new step. */
export function appendStepJog(
  operation: LaserMotionOperation,
  line: string,
  plannedEnd: StepJogQueue['plannedEnd'],
): LaserMotionOperation {
  const settlement = operation.settlementLine;
  const pending = operation.pendingLines;
  const markerQueued = settlement !== undefined && pending[pending.length - 1] === settlement;
  const pendingLines = markerQueued
    ? [...pending.slice(0, -1), line, settlement]
    : [...pending, line, ...(settlement === undefined ? [] : [settlement])];
  const queue = operation.stepJogQueue;
  return {
    ...operation,
    pendingLines,
    ...(queue === undefined ? {} : { stepJogQueue: { ...queue, plannedEnd } }),
  };
}
