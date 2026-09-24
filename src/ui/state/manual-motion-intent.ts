// manual-motion-intent — lets Cancel reach a jog/Frame that has not yet
// installed its motion owner.
//
// runJog, runJogToMachinePosition and runFrame first prove a fresh Idle, which
// can mean writing a status query and awaiting its reply. No motion owner
// exists during that await, so a press-and-hold release that lands there sent
// one 0x85 to an Idle controller and returned. GRBL ignores 0x85 unless it is
// already jogging ("Command is ignored, if not in a JOG state",
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands), and grblHAL raises
// motion cancel only in STATE_JOG (https://github.com/grblHAL/core/blob/master/protocol.c).
// The pending jog then wrote its boundary-length $J= after the operator let go
// (audit jog-home-origin-2).
//
// Every Cancel advances a per-store cancel generation. A manual motion captures
// the generation before its readiness await and refuses to install its owner
// if it changed; nothing reaches the wire. The generation lives in a WeakMap
// keyed by the store's live refs, so independent stores never share it.

import {
  cancelFreshControllerStatusWait,
  type ControllerStatusWaitRefs,
} from './laser-controller-status-wait';

export const MANUAL_MOTION_CANCELLED_MESSAGE =
  'Motion was cancelled before its first command was sent.';

const cancelGenerations = new WeakMap<object, number>();
// Fresh-status waits registered by a cancellable manual motion's readiness
// check. Cancel fails exactly these at once; a phase barrier or an origin or
// Console readiness wait is not Cancel's to end.
const cancellableStatusWaits = new WeakSet<object>();

export function manualMotionCancelGeneration(refs: object): number {
  return cancelGenerations.get(refs) ?? 0;
}

/** Throws when a Cancel arrived after `generation` was captured. Call it
 * synchronously right before the motion owner is installed. */
export function assertManualMotionNotCancelled(refs: object, generation: number): void {
  if (manualMotionCancelGeneration(refs) !== generation) {
    throw new Error(MANUAL_MOTION_CANCELLED_MESSAGE);
  }
}

/** Marks the fresh-status wait just registered on `refs` as one Cancel may end. */
export function markManualMotionStatusWaitCancellable(refs: ControllerStatusWaitRefs): void {
  const wait = refs.controllerStatusWait;
  if (wait != null) cancellableStatusWaits.add(wait);
}

/** Cancels every manual motion that has not installed its owner yet, and fails
 * its readiness wait now instead of after the controller's reply. */
export function cancelPendingManualMotions(refs: ControllerStatusWaitRefs): void {
  cancelGenerations.set(refs, manualMotionCancelGeneration(refs) + 1);
  const wait = refs.controllerStatusWait;
  if (wait != null && cancellableStatusWaits.has(wait)) {
    cancelFreshControllerStatusWait(refs, MANUAL_MOTION_CANCELLED_MESSAGE);
  }
}
