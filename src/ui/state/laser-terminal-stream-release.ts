import type { StatusReport } from '../../core/controllers/grbl';
import { bitFileRunEndPatch } from './bit-file-sequence';
import type { LaserState } from './laser-store';
import { hasOwnedControllerReset } from './laser-reset-cleanup';
import { lostReplyProbeOutstanding, type LostReplyProbeRefs } from './laser-lost-reply-probe';
import { finishedJobStateReset } from './laser-session-reset';

export function shouldReleaseStreamerAtIdle(
  state: Pick<LaserState, 'streamer' | 'controllerOperation'>,
  report: StatusReport,
  refs: LostReplyProbeRefs = {},
): boolean {
  const { streamer, controllerOperation } = state;
  if (streamer === null || report.state !== 'Idle') return false;
  if (hasOwnedControllerReset(controllerOperation)) return false;
  if (streamer.status === 'errored') return true;
  // A finished job whose lost-reply probe is still out waits for its reply,
  // then the ordinary settle releases it (ADR-610 Amendment 1).
  if (lostReplyProbeOutstanding(refs)) return false;
  return streamer.status === 'done' && controllerOperation === null;
}

/** What an Idle report ends. Releasing the streamer is the moment the run is
 * over, so the run's own state goes with it — otherwise a finished CNC job left
 * the store claiming machineKind 'cnc' and holding an unconsumed tool-change
 * queue indefinitely. */
export function streamerEndPatchAtIdle(
  state: LaserState,
  report: StatusReport,
  jobOverAtIdle: boolean,
): Partial<LaserState> {
  if (jobOverAtIdle) {
    return { streamer: null, ...finishedJobStateReset(), ...bitFileRunEndPatch(state) };
  }
  return stoppedBitFileRunEndsAtIdle(state, report) ? bitFileRunEndPatch(state) : {};
}

/** A per-bit file that Abort, an alarm or a reset stopped is never released:
 * its streamer stays 'cancelled' until the next Start. Its bit's run ends at
 * the first Idle after the stop has finished, as a completed file's does at
 * release (rolling audit v5 J1-P3-1, ADR-392 Amendment 5). */
function stoppedBitFileRunEndsAtIdle(state: LaserState, report: StatusReport): boolean {
  return (
    state.streamer?.status === 'cancelled' &&
    (state.bitFileRun ?? null) !== null &&
    report.state === 'Idle' &&
    state.controllerOperation === null
  );
}
