// Audit track MA (Marlin), finding MA-8: on stock Marlin every G0 runs at the
// last F the program set, but KerfDesk writes its Marlin travel and closing
// park as bare `G0 ... S0` and times them as rapids at the profile's maximum
// feed.
//
// Marlin 2.1.2.8 with the stock Configuration_adv.h leaves G0_FEEDRATE
// undefined (L3721 `//#define G0_FEEDRATE 3000 // (mm/min)`), so G0_G1() is one
// handler for both: every `#ifdef G0_FEEDRATE` block is compiled out and G0
// moves at feedrate_mm_s, which only an F word changes
// (gcode.cpp L213-L214 `if (parser.floatval('F') > 0) { feedrate_mm_s =
// parser.value_feedrate();`). KerfDesk's Marlin output (the GRBL body through
// marlin-inline-transform.ts / marlin-fan-transform.ts; grbl-strategy.ts
// laserOffSeekLine L55-L56 writes `G0 X.. Y..` + ` S0` and no F) carries F only
// on G1, so each travel after the first cut and the final
// `G0 X0.000 Y0.000 S0` park run at the cut feed. The estimator times every
// rapid at `limits.maxFeedMmPerMin` (core/gcode-time/segment-blocks.ts
// L35-L36), so the Job Review time, the live countdown and the planned timing
// of a Marlin run are short by the travel time, and a slow cut's park can
// outlast the 30 s post-job settle budget (MA-4).
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/Configuration_adv.h#L3721
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G0_G1.cpp#L47-L73
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L213-L217
// bugfix-2.1.x (3b2b9ca6) is the same: G0_FEEDRATE is still commented out
// (Configuration_adv.h L4204) and gcode.cpp L209-L214 set the one feed rate.
//
// Correct behaviour: for Marlin the plan's duration matches what the firmware
// does with the emitted program — either the output gives G0 its own feed
// (restating the cut F on the next G1) or the estimate times G0 at the modal
// feed. The FIFO model (marlin-fifo-model.ts) moves every block at the modal
// feed and has no acceleration, so its duration is a lower bound for a real
// board.
//
// Result on the audited code: Job Review estimate about 18.5 s on the Generic
// Marlin profile; the same program takes about 82 s on the model (the 328 mm
// park alone is about 66 s at 300 mm/min).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { estimateJobDuration, type Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
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
  it('Job Review times the program as Marlin runs it', async () => {
    const marlinProfile = profileCatalogEntryById('generic-marlin-laser')?.profile;
    if (marlinProfile === undefined) throw new Error('Generic Marlin profile missing');
    const program = marlinStrategy.emit(SHORT_CUT_FAR_FROM_HOME, marlinProfile);
    // Travel and park carry no F: they inherit the preceding feed.
    expect(program).toMatch(/^G0 X200\.000 Y200\.000 S0$/m);
    expect(program).toMatch(/^G1 X260\.000 Y200\.000 F300 S\d+$/m);
    expect(program.trimEnd().split('\n').slice(-1)).toEqual(['G0 X0.000 Y0.000 S0']);

    // The estimate Job Review shows for this job on the Generic Marlin profile.
    const estimate = estimateJobDuration(SHORT_CUT_FAR_FROM_HOME, marlinProfile, {
      initialPosition: { x: 0, y: 0 },
    });
    expect(estimate.unavailableReason).toBeUndefined();
    const planned = estimate.totalSeconds;

    // What Marlin does with the same bytes, streamed by KerfDesk.
    const marlin = createFifoMarlin();
    await useLaserStore
      .getState()
      .connect(marlin.adapter, { controllerKind: 'marlin', baudRate: 250000 });
    marlin.emitLine('start');
    await vi.advanceTimersByTimeAsync(1_500);
    // The first travel runs at whatever feed is modal (Marlin's power-on
    // DEFAULT_FEEDRATE_MM_M 4000 here, a Frame's or jog's F in practice).
    const startedAt = Date.now();
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });

    let finishedAt = Number.NaN;
    for (let second = 0; second < 300; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      const streamer = useLaserStore.getState().streamer;
      const allLinesAcknowledged = streamer === null || streamer.status === 'done';
      const state = marlin.state();
      if (allLinesAcknowledged && !state.moving && state.plannedBlocks === 0) {
        finishedAt = Date.now();
        break;
      }
    }
    expect(marlin.outbound()).toContain('G0 X0.000 Y0.000 S0\n');
    const actualSeconds = (finishedAt - startedAt) / 1000;
    expect(Number.isFinite(actualSeconds)).toBe(true);
    // Current code: about 18.5 s estimated against about 82 s on Marlin.
    expect(actualSeconds).toBeLessThan(planned * 1.25);
  });
});
