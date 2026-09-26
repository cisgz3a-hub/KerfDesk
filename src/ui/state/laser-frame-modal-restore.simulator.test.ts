// Controller audit SM-5: a Smoothieware Frame stopped before its own M121
// left its framing feed as the G0 seek rate, so the next job's travel ran at
// it. The Frame is wrapped in M120 … M121 (ADR-361 item 6) but sent one line
// per completed leg, so a Stop, an Abort (Ctrl-X), a halt or a rejected leg
// ended it before the M121. KerfDesk now sends the pop once the board is
// unhalted and Idle.
//
// Upstream (Smoothieware edge 38e2cc08): F on a G0 sets seek_rate at parse
// time (Robot.cpp L1144-L1149); M120/M121 push/pop it and M121 on an empty
// stack does nothing (Robot.cpp L331-L352, L777-L783); Robot has no halt
// handler (Robot.cpp L131-L133). The simulator models all three.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L1144-L1149

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

const DEFAULT_SEEK_RATE = 4000; // smoothie-simulator default_seek_rate
const FRAME_FEED = 1500;
const BOUNDS = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
const TRAVEL_JOB = 'G21\nG90\nG0 X30 Y20 S0\nG1 X40 Y20 F600 S0.5\nG0 X5 Y5 S0\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    homingState: 'unknown',
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectSmoothieIdle(): Promise<SmoothieSimulator> {
  // Legs long enough that the operator can stop the Frame while it traces.
  const sim = createSmoothieSimulator({ motionMs: 1_500 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

/** Start a Frame and wait until its first framing leg (a `G0 … F`) is moving. */
async function frameUntilFirstLeg(sim: SmoothieSimulator): Promise<Promise<unknown>> {
  const frame = useLaserStore
    .getState()
    .frame(BOUNDS, FRAME_FEED)
    .catch(() => undefined);
  for (let t = 0; t < 1_000 && !sim.outbound().some((l) => /^G0 .*F/.test(l)); t += 1) {
    await pump(10);
  }
  expect(sim.state()).toMatchObject({ seekRate: FRAME_FEED, stateStackDepth: 1 });
  return frame;
}

function popsSent(sim: SmoothieSimulator): number {
  return sim.outbound().filter((line) => line === 'M121\n').length;
}

describe('SM-5: a Smoothieware Frame stopped before its M121', () => {
  it('restores the seek rate after Stop motion, so the next job travels at the configured rate', async () => {
    const sim = await connectSmoothieIdle();
    const frame = await frameUntilFirstLeg(sim);
    const cancel = useLaserStore
      .getState()
      .cancelJog()
      .catch(() => undefined);
    await pump(10_000);
    await cancel;
    await frame;
    expect(useLaserStore.getState().motionOperation).toBeNull();
    // The Frame never reached its own M121; KerfDesk sent exactly one.
    expect(popsSent(sim)).toBe(1);
    expect(sim.state()).toMatchObject({ seekRate: DEFAULT_SEEK_RATE, stateStackDepth: 0 });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    const movesBefore = sim.state().seekMoveRates.length;
    await startTestLaserJob(TRAVEL_JOB, { streamingMode: 'ping-pong' });
    await pump(8_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().seekMoveRates.slice(movesBefore)).toEqual([
      DEFAULT_SEEK_RATE,
      DEFAULT_SEEK_RATE,
    ]);
  });

  it('restores it after ABORT MOTION (Ctrl-X) only once Unlock (M999) leaves the halt', async () => {
    const sim = await connectSmoothieIdle();
    const frame = await frameUntilFirstLeg(sim);
    const stop = useLaserStore
      .getState()
      .stopJob()
      .catch(() => undefined);
    await pump(3_000);
    await stop;
    await frame;
    // Halted, the board would answer M121 with `!!`: nothing is sent yet.
    expect(sim.state().isHalted).toBe(true);
    expect(popsSent(sim)).toBe(0);

    const unlock = useLaserStore
      .getState()
      .unlockAlarm()
      .catch(() => undefined);
    await pump(3_000);
    await unlock;
    expect(sim.state().isHalted).toBe(false);
    expect(popsSent(sim)).toBe(1);
    expect(sim.state()).toMatchObject({ seekRate: DEFAULT_SEEK_RATE, stateStackDepth: 0 });
  });

  it('restores it after a hard-limit halt during the Frame', async () => {
    const sim = await connectSmoothieIdle();
    const frame = await frameUntilFirstLeg(sim);
    sim.hardLimit('+X');
    await pump(2_000);
    await frame;
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(popsSent(sim)).toBe(0);

    const unlock = useLaserStore
      .getState()
      .unlockAlarm()
      .catch(() => undefined);
    await pump(3_000);
    await unlock;
    expect(popsSent(sim)).toBe(1);
    expect(sim.state()).toMatchObject({ seekRate: DEFAULT_SEEK_RATE, stateStackDepth: 0 });
  });

  it('sends no extra M121 after a Frame that completes', async () => {
    const sim = await connectSmoothieIdle();
    const frame = useLaserStore.getState().frame(BOUNDS, FRAME_FEED);
    await pump(20_000);
    await frame;
    expect(useLaserStore.getState().motionOperation).toBeNull();
    await pump(2_000);
    expect(popsSent(sim)).toBe(1); // the Frame's own
    expect(sim.state()).toMatchObject({ seekRate: DEFAULT_SEEK_RATE, stateStackDepth: 0 });
    expect(useLaserStore.getState().framePushesAwaitingPop).toBe(0);
  });
});
