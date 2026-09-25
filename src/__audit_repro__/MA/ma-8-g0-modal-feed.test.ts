// Audit track MA (Marlin), finding MA-8: on stock Marlin every G0 runs at the
// last G1 feed, but KerfDesk writes its Marlin travel and closing park as bare
// `G0 ... S0` and times them as rapids at the profile's maximum feed.
//
// Marlin 2.1.2.8 with the stock Configuration_adv.h leaves G0_FEEDRATE
// undefined (L3721), so G0_G1() is one handler for both: G0 has no speed of
// its own and moves at feedrate_mm_s, which only an F word changes
// (gcode.cpp get_destination_from_command: `if (parser.floatval('F') > 0)
// feedrate_mm_s = ...`). KerfDesk's Marlin output (grbl body through
// marlin-inline-transform.ts / marlin-fan-transform.ts) carries F only on G1,
// so each travel and the final `G0 X0.000 Y0.000 S0` park run at the cut feed.
// The estimator times a rapid at `limits.maxFeedMmPerMin`
// (core/gcode-time/segment-blocks.ts), so the Job Review time, the live
// countdown and the "running" timing of a Marlin run are short by the travel
// time, and a slow cut's park can outlast the 30 s settle budget (MA-4).
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/Configuration_adv.h#L3721
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G0_G1.cpp#L47-L73
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L210-L214
//
// Correct behaviour: for Marlin the plan's duration matches what the firmware
// does with the emitted program — either the output gives G0 its own feed
// (restating the cut F on the next G1) or the estimate times G0 at the modal
// feed. The FIFO model (marlin-fifo-model.ts) moves every block at the modal
// feed, as Marlin does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { laserCountdownTestHandoff } from '../../ui/state/laser-countdown-test-handoff';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { createFifoMarlin } from './marlin-fifo-model';

const SHORT_CUT_FAR_FROM_HOME: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 300,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 200, y: 200 },
            { x: 260, y: 200 },
          ],
          closed: false,
        },
      ],
    },
  ],
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

describe('MA-8: Marlin G0 moves at the modal feed', () => {
  it('the plan times the program as Marlin runs it', async () => {
    const program = marlinStrategy.emit(SHORT_CUT_FAR_FROM_HOME, {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
    // Travel and park carry no F: they inherit the preceding feed.
    expect(program).toMatch(/^G0 X200\.000 Y200\.000 S0$/m);
    expect(program).toMatch(/^G0 X0\.000 Y0\.000 S0$/m);

    const marlin = createFifoMarlin();
    await useLaserStore
      .getState()
      .connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
    marlin.emitLine('start');
    await vi.advanceTimersByTimeAsync(1_500);
    // The first travel runs at whatever feed is modal (Marlin's power-on
    // DEFAULT_FEEDRATE_MM_M 4000 here, a Frame's or jog's F in practice).

    const startedAt = Date.now();
    await startTestLaserJob(program, {
      streamingMode: 'ping-pong',
      ...laserCountdownTestHandoff({ gcode: program, retentionKey: 'ma-8', capability: 'settle-only' }),
    });
    await vi.advanceTimersByTimeAsync(100);
    const timing = useLaserStore.getState().liveCanvasRun?.timing;
    const planned =
      timing !== undefined && 'plan' in timing ? timing.plan.totalSeconds : Number.NaN;
    expect(Number.isFinite(planned)).toBe(true);

    let finishedAt = Number.NaN;
    for (let second = 0; second < 300; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      if (!marlin.state().moving && marlin.state().plannedBlocks === 0 && second > 2) {
        finishedAt = Date.now();
        break;
      }
    }
    const actualSeconds = (finishedAt - startedAt) / 1000;
    // Current code: about 18.5 s planned against about 80 s on Marlin.
    expect(actualSeconds).toBeLessThan(planned * 1.25);
  });
});
