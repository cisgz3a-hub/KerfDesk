// laser-motion-release — releases a motion owner nothing else would release.
//
// A jog/Frame owner is marked cancelRequested when the controller rejects one
// of its lines (GRBL error:15 soft limit on a step jog, a rejected Frame leg or
// CNC safe-Z retract), when its write fails, or when an operator Cancel gives
// up (for example a Falcon G1 leg longer than the cancel deadline). Only a
// Cancel settlement's stamped status query could release it, so these owners
// stayed forever: Jog, Frame, Home and Start refused as busy while the machine
// sat Idle, and the only visible exit was ABORT MOTION's soft reset, which
// drops the work origin (audit jog-home-origin-1 / status-1 / job-lifecycle-5).
//
// GRBL rejects an out-of-travel jog before planning it: jog.c jog_execute()
// returns STATUS_TRAVEL_EXCEEDED ahead of mc_line(), and the wiki says such
// jogs "simply do not execute the command and return an error"
// (https://github.com/gnea/grbl/blob/master/grbl/jog.c,
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging). grblHAL does the same
// unless $40 clips the jog (https://github.com/grblHAL/core/blob/master/motion_control.c).
// So once the owner's acknowledgements have drained and a fresh report says
// Idle, KerfDesk runs the Cancel settlement itself.

import type { StatusReport } from '../../core/controllers/grbl';
import type { GetFn, SafeWriteFn, SetFn } from './laser-line-shared';
import { settleAbandonedMotionOperation } from './laser-motion-cancel';
import type { MotionCancelRefs } from './laser-motion-cancel-context';
import { isAbandonedMotionOperation } from './laser-motion-operation';
import { pushLog } from './laser-store-helpers';

/** One retry covers a transient timeout; a settlement that keeps failing is
 * left to the operator (Cancel, ABORT MOTION or reconnect) instead of looping
 * at the poll cadence. */
const MAX_AUTOMATIC_RELEASE_ATTEMPTS = 2;

/** Called by the status pipeline after it applied `report`. */
export function releaseAbandonedMotionAtIdle(
  set: SetFn,
  get: GetFn,
  refs: MotionCancelRefs,
  safeWrite: SafeWriteFn,
  report: StatusReport,
): void {
  if (report.state !== 'Idle' || report.mpgActive === true) return;
  const state = get();
  const operation = state.motionOperation;
  if (!isAbandonedMotionOperation(operation)) return;
  if ((operation.automaticReleaseAttempts ?? 0) >= MAX_AUTOMATIC_RELEASE_ATTEMPTS) return;
  // A realtime report that arrives with no owed ack outstanding was generated
  // after every terminal response to the owner's lines, so this Idle is causal
  // to the rejection. Marlin's queued M114 report arrives before the query's
  // own ok, and the poller sends M114 only once every earlier ack drained
  // (the same reasoning observeOwnedMotionStatus applies).
  const owedAcks = refs.driver.commands.queuedStatusQuery === null ? state.pendingUntrackedAcks : 0;
  if (owedAcks > 0 || (operation.pendingMotionTransportWrites ?? 0) > 0) return;
  // Another settlement or command owns the controller's replies right now;
  // the next Idle report tries again.
  if (refs.controllerCommand !== null || refs.controllerStatusWait != null) return;
  set({
    log: pushLog(
      state,
      `[lf2] Controller is Idle after the cancelled ${operation.kind}. Confirming it has settled before releasing motion control.`,
    ),
  });
  void settleAbandonedMotionOperation(set, get, refs, safeWrite);
}
