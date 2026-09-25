// Audit track MA (Marlin), finding MA-7: ABORT on Marlin does not stop the
// laser. It stops sending and queues `M5 I` + `M107`, which Marlin runs only
// after every move already in its 16-block planner has finished, beam on.
// Marlin has an immediate stop that needs no reset — M410 — and KerfDesk never
// sends it.
//
// KerfDesk: laser-job-actions.ts runStopJob, `softReset === null` branch,
// writes driver.commands.stopLaserLines = ['M5 I', 'M107']
// (core/controllers/marlin/commands.ts). Its own notice concedes "Buffered
// motion or laser output may still be active" and claims KerfDesk "could only
// stop sending and queue beam-off commands" (laser-safety-notice.ts).
//
// Upstream (Marlin 2.1.2.8, stock configuration):
// - `ok` for a G1 is sent once the move is PLANNED (gcode.cpp L1122 after
//   G0_G1 -> planner.buffer_line), so ping-pong streaming keeps up to
//   BLOCK_BUFFER_SIZE (16) moves queued (Configuration_adv.h L2396).
// - M5 calls planner.synchronize() before turning the output off
//   (control/M3-M5.cpp L142-L154), so the beam-off waits for all of them.
// - M410 "Quickstop - Abort all planned moves" is acted on when the line is
//   read, before it is queued, with EMERGENCY_PARSER disabled
//   (gcode/queue.cpp L538-L545, `quickstop_stepper()`), and by the emergency
//   parser when it is enabled (feature/e_parser.h L217, temperature.cpp
//   L1876-L1878). Reading also runs inside idle() while a G1 waits for a
//   planner slot (MarlinCore.cpp manage_inactivity -> get_available_commands).
//   quickstop_stepper() drops the planner (planner.cpp quick_stop) without a
//   reset; M410's own doc warns the position may be lost (no deceleration).
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L538-L545
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M108_M112_M410.cpp#L44-L53
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1678-L1705
//
// The repo's Marlin simulator answers every line at once and runs queued moves
// concurrently, so it cannot show this; marlin-fifo-model.ts follows the
// upstream queue/planner rules above.
//
// Correct behaviour: after ABORT the beam is off within a fraction of a second
// (e.g. M410 then M5 I / M107), with position evidence invalidated because a
// quickstop can lose steps.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { createFifoMarlin } from './marlin-fifo-model';

// A 200 x 100 mm rectangle cut three times at 300 mm/min: 12 burn moves of
// 20-40 s each, 6 minutes of cutting that all fit in Marlin's planner.
const RECTANGLE_CUT: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 80,
      speed: 300,
      passes: 3,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 50, y: 50 },
            { x: 250, y: 50 },
            { x: 250, y: 150 },
            { x: 50, y: 150 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

const MARLIN_INLINE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  maxPowerS: 255,
  gcodeDialect: { dialectId: 'marlin-inline' },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ safetyNotice: null, streamer: null, controllerOperation: null });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MA-7: Marlin ABORT leaves the planned burn running', () => {
  it('turns the beam off promptly after ABORT', async () => {
    const marlin = createFifoMarlin();
    await useLaserStore
      .getState()
      .connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
    marlin.emitLine('start');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    const program = marlinStrategy.emit(RECTANGLE_CUT, MARLIN_INLINE);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });
    await vi.advanceTimersByTimeAsync(5_000);
    // Burning, with most of the job already accepted into the planner.
    expect(marlin.state().output).toBeGreaterThan(0);
    expect(marlin.state().plannedBlocks).toBeGreaterThan(8);

    const abortAt = Date.now();
    await useLaserStore.getState().stopJob();
    await vi.advanceTimersByTimeAsync(7 * 60_000);

    // Current code: the beam stays on for the rest of the planned job
    // (about 355 s here). Correct: off within half a second.
    expect(marlin.beamOnMsSince(abortAt)).toBeLessThan(500);
  });
});
