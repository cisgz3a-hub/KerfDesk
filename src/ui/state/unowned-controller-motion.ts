// unowned-controller-motion — motion the controller reports that no job,
// operation, jog, Frame or Fire here owns (controller audit 2, ADR-375 C-2).
//
// A Console G0/G1, `$J=` or `$H` runs with no owner in KerfDesk, so the Live
// Motion bar, the Ctrl+. shortcut and the crash screen offered no software
// stop for it: Disconnect was the only one. The controller's own report is the
// evidence. Run, Jog and Home are motion; Hold and Door are motion it stopped
// and still holds for a cycle start. Stock GRBL answers no status query while
// it homes, so a Console `$H` there shows only once homing ends.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L320-L324

import type { GrblState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

export type UnownedControllerMotion = Extract<GrblState, 'Run' | 'Jog' | 'Home' | 'Hold' | 'Door'>;

type UnownedMotionEvidence = Pick<
  LaserState,
  | 'connection'
  | 'streamer'
  | 'controllerOperation'
  | 'motionOperation'
  | 'fireActive'
  | 'mpgActive'
  | 'statusReport'
>;

const MOTION_STATES: ReadonlySet<GrblState> = new Set(['Run', 'Jog', 'Home', 'Hold', 'Door']);

/** The reported motion state when nothing here owns it, or null. A stale
 *  report does not count once the port is closed. */
export function unownedControllerMotion(
  state: UnownedMotionEvidence,
): UnownedControllerMotion | null {
  if (state.connection.kind !== 'connected' || hasMotionOwner(state)) return null;
  const reported = state.statusReport?.state ?? null;
  return reported !== null && MOTION_STATES.has(reported)
    ? (reported as UnownedControllerMotion)
    : null;
}

// The Live Motion bar's owners, in its order, and a grblHAL pendant: MPG:1
// hands motion control to the pendant, which KerfDesk does not command
// (mpgCommandBlockMessage).
function hasMotionOwner(state: UnownedMotionEvidence): boolean {
  return (
    isActiveJob(state.streamer) ||
    state.controllerOperation !== null ||
    state.motionOperation !== null ||
    state.fireActive ||
    state.mpgActive === true
  );
}
