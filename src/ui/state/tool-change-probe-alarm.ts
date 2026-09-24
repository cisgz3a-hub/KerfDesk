// A touch-off probe that misses during a CNC tool-change hold (controller audit
// streaming-3). GRBL 1.1, grblHAL and FluidNC report ALARM:4 (probe already
// triggered) and ALARM:5 (no contact within the travel) without losing
// position: only the probe motion stopped. Once the hold has drained the
// pre-M0 tail and seen Idle, nothing of the job is inside the controller, so
// cancelling the rest of a multi-tool job there only forced checkpoint
// recovery where a re-probe would do.
//
// Such a hold now survives these two alarms. The operator unlocks, re-zeroes
// the new bit and presses Continue, which still waits for a fresh Idle
// (re-armed at the alarm) and for work-Z evidence newer than the alarm. The
// program restates its modal state after each M0, so the probe's unfinished
// G91 cannot reach the job. Every other alarm, an Alarm report with no
// numbered alarm, Sleep and a reboot still cancel the hold.

import type { StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

const PROBE_ALARM_CODES: ReadonlySet<number> = new Set([4, 5]);

function isDrainedToolChangeHold(streamer: StreamerState | null): boolean {
  return streamer?.status === 'tool-change' && streamer.inFlight.length === 0;
}

/** Whether ALARM:`code`, arriving now, leaves the tool-change hold in place. */
export function probeAlarmKeepsToolChangeHold(
  state: Pick<LaserState, 'streamer' | 'toolChangeIdleSeen'>,
  code: number,
): boolean {
  return (
    PROBE_ALARM_CODES.has(code) &&
    isDrainedToolChangeHold(state.streamer) &&
    state.toolChangeIdleSeen
  );
}

/** A tool-change hold that a probe alarm stopped: its Alarm reports keep the
 *  hold, and the operator's `$X` may unlock the controller inside it. */
export function isProbeAlarmedToolChangeHold(
  state: Pick<LaserState, 'streamer' | 'alarmCode'>,
): boolean {
  return (
    state.alarmCode !== null &&
    PROBE_ALARM_CODES.has(state.alarmCode) &&
    isDrainedToolChangeHold(state.streamer)
  );
}
