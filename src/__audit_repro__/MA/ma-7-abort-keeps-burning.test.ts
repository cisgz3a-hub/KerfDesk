// Audit track MA (Marlin), finding MA-7: ABORT on Marlin does not stop the
// laser. It stops sending and queues `M5 I` + `M107`, which Marlin runs only
// after every move already in its 16-block planner has finished, beam on.
// Marlin has an immediate stop that needs no reset — M410 — and KerfDesk never
// sends it.
//
// KerfDesk: laser-job-actions.ts runStopJob, `softReset === null` branch
// (L313-L327), writes driver.commands.stopLaserLines = ['M5 I', 'M107']
// (core/controllers/marlin/commands.ts L17). Its own notice concedes "Buffered
// motion or laser output may still be active" and claims KerfDesk "could only
// stop sending and queue beam-off commands" (laser-safety-notice.ts L134-L138).
//
// Upstream (Marlin 2.1.2.8, stock configuration with LASER_FEATURE enabled):
// - `ok` for a G1 is sent once the move is PLANNED (gcode.cpp L1122 after
//   G0_G1 -> planner.buffer_line), so ping-pong streaming keeps up to
//   BLOCK_BUFFER_SIZE (16) moves queued (Configuration_adv.h L2396).
// - M5 calls planner.synchronize() before turning the output off
//   (control/M3-M5.cpp L142-L145), so the beam-off waits for all of them.
// - M410 "Quickstop - Abort all planned moves" is acted on when the line is
//   read, before it is queued, with EMERGENCY_PARSER disabled
//   (gcode/queue.cpp L538-L545, `quickstop_stepper()`), and by the emergency
//   parser when it is enabled (feature/e_parser.h L217, temperature.cpp
//   L1876-L1878). Reading also runs inside idle() while a G1 waits for a
//   planner slot (MarlinCore.cpp L408-L410 manage_inactivity ->
//   queue.get_available_commands()). quickstop_stepper() drops the planner
//   (planner.cpp L1678-L1705 quick_stop) without a reset; the G1 that was
//   waiting for a slot is then dropped too (planner.cpp L1827-L1830). M410's
//   own comment warns the carriages "will be out of sync with the stepper
//   position" (M108_M112_M410.cpp L46-L53).
// - M410 does not touch the cutter: a continuous-mode output stays at the last
//   block's power until LASER_SAFETY_TIMEOUT_MS (1000 ms stock,
//   Configuration_adv.h L3432; temperature.cpp L3516-L3521) or until a
//   following `M5 I` runs after quick_stop's one-second cleaning window
//   (Planner::busy() counts cleaning_buffer_counter, planner.cpp L1735-L1739).
//   So the best Marlin can do is about one second, not the rest of the job.
// bugfix-2.1.x (3b2b9ca6) acts on M410 at read time regardless of
// EMERGENCY_PARSER (queue.cpp L538-L543) and keeps the same quick_stop.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L538-L545
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M108_M112_M410.cpp#L44-L53
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1678-L1705
//
// The repo's Marlin simulator answers every line at once and runs queued moves
// concurrently, so it cannot show this; marlin-fifo-model.ts follows the
// upstream queue/planner rules above.
//
// Correct behaviour: after ABORT the beam is off within about a second (e.g.
// M410 then M5 I / M107), with position evidence invalidated because a
// quickstop can lose steps. Current code: about 200 s of burning.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { createFifoMarlin } from './marlin-fifo-model';

// One serpentine cut at 300 mm/min: five 200 mm passes joined by 5 mm steps,
// 1020 mm (about 204 s) of burning that fits in Marlin's 16-block planner.
const SERPENTINE_CUT: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 80,
      speed: 300,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 50, y: 50 },
            { x: 250, y: 50 },
            { x: 250, y: 55 },
            { x: 50, y: 55 },
            { x: 50, y: 60 },
            { x: 250, y: 60 },
            { x: 250, y: 65 },
            { x: 50, y: 65 },
            { x: 50, y: 70 },
            { x: 250, y: 70 },
          ],
          closed: false,
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

// One second of LASER_SAFETY_TIMEOUT_MS / cleaning window, plus margin.
const BEST_MARLIN_STOP_MS = 1_500;

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

async function connectFifoMarlin(): Promise<ReturnType<typeof createFifoMarlin>> {
  const marlin = createFifoMarlin();
  await useLaserStore
    .getState()
    .connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
  marlin.emitLine('start');
  await vi.advanceTimersByTimeAsync(1_500);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return marlin;
}

describe('MA-7: Marlin ABORT leaves the planned burn running', () => {
  it('the model stops a planned burn within about a second when it receives M410', async () => {
    // Control: the model itself is not what keeps the beam on.
    const marlin = await connectFifoMarlin();
    const program = marlinStrategy.emit(SERPENTINE_CUT, MARLIN_INLINE);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(marlin.state().output).toBeGreaterThan(0);
    // Stream-side Pause only stops KerfDesk sending; the planner keeps burning.
    await useLaserStore.getState().pauseJob();
    const stopAt = Date.now();
    // Wire bytes a Marlin-aware Abort could send, written straight to the port.
    const port = await marlin.adapter.serial.requestPort();
    if (port === null) throw new Error('model port missing');
    const connection = await port.open({ baudRate: 250000 });
    await connection.write('M410\nM5 I\nM107\n');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(marlin.beamOnMsSince(stopAt)).toBeLessThan(BEST_MARLIN_STOP_MS);
    expect(marlin.state().plannedBlocks).toBe(0);
  });

  it('turns the beam off promptly after ABORT', async () => {
    const marlin = await connectFifoMarlin();
    const program = marlinStrategy.emit(SERPENTINE_CUT, MARLIN_INLINE);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });
    await vi.advanceTimersByTimeAsync(5_000);
    // Burning, with most of the job already accepted into the planner.
    expect(marlin.state().output).toBeGreaterThan(0);
    expect(marlin.state().plannedBlocks).toBeGreaterThan(5);

    const abortAt = Date.now();
    await useLaserStore.getState().stopJob();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    // Current code: the beam stays on for the rest of the planned job
    // (about 200 s here). Correct: off within about a second.
    expect(marlin.beamOnMsSince(abortAt)).toBeLessThan(BEST_MARLIN_STOP_MS);
  });

  it('ABORT MOTION stops a long jog within about a second', async () => {
    // The Live Motion bar's ABORT MOTION (jog, Frame) is the same stopJob
    // path; with no active job it does not even raise the notice.
    const marlin = await connectFifoMarlin();
    const jog = useLaserStore
      .getState()
      .jog({ dx: 200, feed: 300 })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_000);
    // 200 mm at 300 mm/min: a 40 s move is under way.
    expect(marlin.state().moving).toBe(true);

    const abortAt = Date.now();
    await useLaserStore.getState().stopJob();
    let stoppedAt = Number.NaN;
    for (let elapsed = 0; elapsed < 120_000; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      if (!marlin.state().moving && marlin.state().plannedBlocks === 0) {
        stoppedAt = Date.now();
        break;
      }
    }
    await jog;
    // Current code: the head travels on for the rest of the jog (about 38 s).
    expect(stoppedAt - abortAt).toBeLessThan(BEST_MARLIN_STOP_MS);
  });
});
