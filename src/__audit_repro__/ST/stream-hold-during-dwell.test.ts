// ST-5 repro — a programmed spindle spin-up dwell is announced as
// "CONTROLLER HOLDING PROGRAM" (and logged as the controller holding the
// program) although the controller is executing exactly what it was sent.
//
// Correct behaviour: while the oldest unacknowledged line is a `G4 P<s>` dwell
// whose programmed time has not yet elapsed, the controller is not holding the
// program; GRBL acknowledges G4 only after the planner drains and the dwell
// ends, reporting Idle meanwhile:
//   grbl/motion_control.c:195-200 mc_dwell(): protocol_buffer_synchronize(); delay_sec(seconds, DELAY_MODE_DWELL);
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L195-L200
//   grbl/nuts_bolts.c delay_sec(): serves realtime (status) every DWELL_TIME_STEP 50 ms while idle.
// KerfDesk's CNC emitter writes `G4 P<spindleSpinupSec>` after every M3
// (cnc-grbl-transitions.ts appendSpindleStart; default 3 s, machine.ts:274), so
// every job start and every tool-change Continue with a spin-up >= 3 s shows
// the hold banner (STREAM_HOLD_VISIBLE_MS = 3 s) and writes the
// "[lf2] Controller holding program: ..." log line.

import { describe, expect, it } from 'vitest';
import { createStreamer, onAck, step } from '../../core/controllers/grbl';
import type { StatusReport } from '../../core/controllers/grbl';
import { detectStreamStall } from '../../ui/state/laser-stream-stall';
import { streamHoldFromProbe } from '../../ui/state/laser-stream-hold';

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 5 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 12000,
  buffer: null,
} as StatusReport;

describe('ST-5: a programmed G4 spin-up dwell is not a controller hold', () => {
  it('does not report CONTROLLER HOLDING PROGRAM during a 5 s spin-up dwell', () => {
    // G0 Z5 and M3 are acknowledged; G4 P5 is executing; the rest waits.
    let streamer = step(createStreamer('G0 Z5\nM3 S12000\nG4 P5\nG1 X10 F500\nG1 X20\n')).state;
    streamer = step(onAck(streamer, 'ok').state).state;
    streamer = step(onAck(streamer, 'ok').state).state;
    expect(streamer.inFlight[0]?.line).toBe('G4 P5\n');

    const t0 = 10_000;
    let probe = detectStreamStall(streamer, IDLE, null, t0).probe;
    for (let t = t0 + 250; t <= t0 + 4_000; t += 250) {
      probe = detectStreamStall(streamer, IDLE, probe, t).probe;
    }
    const hold = streamHoldFromProbe({ streamer, statusReport: IDLE }, probe, t0 + 4_000);
    expect(hold).toBeNull();
  });
});
