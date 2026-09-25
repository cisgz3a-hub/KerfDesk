// Audit track MA (Marlin), finding MA-1: a stream-side Pause leaves the laser
// lit over a stopped head.
//
// Marlin has no realtime hold, so KerfDesk pauses by stopping the stream
// (laser-job-pause-resume.ts: `pauseByte === null` -> freezeStreamer + notice).
// Nothing is sent to switch the beam off. What Marlin 2.1.2.8 then does:
//
// - Fan dialect. M106 sets thermalManager.fan_speed at once (M106_M107.cpp,
//   `thermalManager.set_fan_speed(pfan, speed)`). While blocks are queued the
//   output follows the executing block's captured speed; once the planner is
//   empty Planner::check_axes_activity() drives the fan from the CURRENT
//   fan_speed (planner.cpp:1388-1399, "else { ... thermalManager.scaledFanSpeed(i)").
//   KerfDesk's fan program writes `M106 S<n>` on the line BEFORE its burn move
//   (marlin-fan-transform.ts setFanPower), so a Pause that lands after that line
//   lights the fan-header laser over the stopped head, with no timeout at all.
// - Inline dialect. In CUTTER_MODE_CONTINUOUS the stepper applies a block's
//   power when the block starts and does nothing when the planner runs dry
//   (stepper.cpp:2341-2345 blanks only CUTTER_MODE_DYNAMIC), so the last burn
//   block's power stays on the stopped head until Temperature::isr's
//   LASER_SAFETY_TIMEOUT_MS (1000 ms in the stock Configuration_adv.h;
//   temperature.cpp:3516-3521) or forever on a configuration without it.
//
// Correct behaviour: once a paused Marlin job has drained its buffered motion,
// the beam is off (fan speed 0 / cutter output 0), e.g. because Pause queues a
// beam-off line (M107, or M5 for inline) behind the buffered motion and Resume
// restores the program's power before the next burn move.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1388-L1399
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/stepper.cpp#L2341-L2345
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/temperature.cpp#L3516-L3521
// The oracles are the repo's Marlin simulator and marlin-laser-power-model.ts
// (ported from those upstream rules; ADR-364).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import {
  powerUpMarlin,
  runMarlinLines,
} from '../../__fixtures__/controllers/marlin-laser-power-model';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const CUT_JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 600,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 60, y: 10 },
            { x: 60, y: 60 },
            { x: 10, y: 60 },
          ],
          closed: true,
        },
        {
          polyline: [
            { x: 100, y: 10 },
            { x: 150, y: 10 },
            { x: 150, y: 60 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const MARLIN_DEVICE: DeviceProfile = {
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
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function connectMarlinIdle(): Promise<MarlinSimulator> {
  // Each queued move takes 3 s, so buffered motion is still running at Pause.
  const sim = createMarlinSimulator({ motionMs: 3_000 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

/** Pump 1 ms at a time until the single ping-pong line in flight matches. */
async function pauseWhenInFlight(pattern: RegExp): Promise<string> {
  for (let elapsed = 0; elapsed < 5_000; elapsed += 1) {
    const line = useLaserStore.getState().streamer?.inFlight[0]?.line ?? '';
    if (pattern.test(line.trim())) {
      await useLaserStore.getState().pauseJob();
      return line.trim();
    }
    await vi.advanceTimersByTimeAsync(1);
  }
  throw new Error(`No in-flight line matched ${pattern}`);
}

describe('MA-1: stream-side Pause on Marlin leaves the beam on over the stopped head', () => {
  it('fan dialect: after the buffered motion drains, the fan-header laser stays on', async () => {
    const program = marlinStrategy.emit(CUT_JOB, {
      ...MARLIN_DEVICE,
      gcodeDialect: { dialectId: 'marlin-fan' },
    });
    expect(program).toMatch(/^M106 S128$/m);
    const sim = await connectMarlinIdle();
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });

    const pausedAt = await pauseWhenInFlight(/^M106 S[1-9]/);
    expect(pausedAt).toBe('M106 S128');
    await vi.advanceTimersByTimeAsync(8_000);

    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    // The machine has stopped: nothing is left in the simulated planner.
    expect(sim.state().pendingMotions).toBe(0);
    // Correct behaviour: a drained, paused job has the beam off.
    // Current code: fan_speed[0] is still 128, which Marlin drives onto the
    // idle fan header (planner.cpp:1388-1399) — the laser burns in place.
    expect(sim.state().fanPower).toBe(0);
  });

  it('inline dialect: after the buffered motion drains, the last burn power stays applied', async () => {
    const program = marlinStrategy.emit(CUT_JOB, MARLIN_DEVICE);
    const sim = await connectMarlinIdle();
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });

    // Pause right after a burn move with an explicit S word.
    await pauseWhenInFlight(/^G1 .*S[1-9]/);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(sim.state().pendingMotions).toBe(0);

    // Replay exactly what the controller received through the upstream-derived
    // power model: `output` is the cutter output with the planner empty.
    const received = sim
      .outbound()
      .flatMap((write) => write.split('\n'))
      .filter((line) => line.trim() !== '' && !/^M114\b/.test(line));
    const model = runMarlinLines(powerUpMarlin(), received);
    expect(model.mode).toBe('continuous');
    // Correct behaviour: 0. Current code: the last block's power (128) stays on
    // until LASER_SAFETY_TIMEOUT_MS, or indefinitely on a build without it.
    expect(model.output).toBe(0);
  });
});
