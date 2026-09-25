// Audit SM-5 repro: a Frame stopped part-way leaves its framing feed as
// Smoothieware's G0 seek rate, so the next job's travel moves run at it.
// Incomplete fix of ADR-361 item 6 ("Jog feed no longer changes the G0 seek
// rate"), which wrapped jog and Frame in M120 ... M121.
//
// Correct behaviour: every manual move must leave Robot's seek rate as it found
// it. KerfDesk dispatches a Smoothieware Frame one line per fresh Idle (M120,
// G21, G90, five `G0 X Y F<frame>` legs, then M121), so M121 goes out only
// after the last leg. Stop motion (Ctrl/Cmd+. -> cancelJog), ABORT MOTION (Ctrl-X), a halt
// or a rejected leg ends dispatch before M121, and the push is never popped.
//
// Upstream evidence (Smoothieware edge 38e2cc08):
// - Robot::process_move applies F at parse time: `if( motion_mode == SEEK )
//   this->seek_rate = ...` (src/modules/robot/Robot.cpp L1144-L1149).
// - M120/M121 push/pop feed_rate, seek_rate, absolute/inch mode and the WCS
//   (Robot.cpp L777-L783, pop_state L340-L352).
// - Robot registers only ON_GCODE_RECEIVED (Robot.cpp L131-L133): no halt,
//   Ctrl-X or M999 path pops or resets the state.
// - A bare `G0` (KerfDesk's job travel carries no F) runs at seek_rate.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L1144-L1149
//
// The simulator models the seek/feed split and M120/M121 (smoothie-simulator.ts
// applyRates/handleRobotState), so this runs against it directly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const DEFAULT_SEEK_RATE = 4000; // smoothie-simulator default_seek_rate
const FRAME_FEED = 1500;
const TRAVEL_JOB = 'G21\nG90\nG0 X30 Y20 S0\nG1 X40 Y20 F600 S0.5\nG0 X5 Y5 S0\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
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

describe('SM-5: a Frame stopped before its M121', () => {
  it('leaves the next job travel at the configured seek rate', async () => {
    const sim = await connectSmoothieIdle();
    const frame = useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, FRAME_FEED)
      .catch(() => undefined);
    // Wait until the first framing leg is moving, then Stop motion (Ctrl/Cmd+. -> cancelJog).
    for (let t = 0; t < 1_000 && !sim.outbound().some((l) => /^G0 .*F/.test(l)); t += 1) {
      await pump(10);
    }
    expect(sim.state().seekRate).toBe(FRAME_FEED);
    const cancel = useLaserStore
      .getState()
      .cancelJog()
      .catch(() => undefined);
    await pump(10_000);
    await cancel;
    await frame;
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(sim.outbound()).not.toContain('M121\n');

    const movesBefore = sim.state().seekMoveRates.length;
    await startTestLaserJob(TRAVEL_JOB, { streamingMode: 'ping-pong' });
    await pump(8_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    // Fails today: both job travel moves run at the 1500 mm/min framing feed.
    expect(sim.state().seekMoveRates.slice(movesBefore)).toEqual([
      DEFAULT_SEEK_RATE,
      DEFAULT_SEEK_RATE,
    ]);
  });

  it('leaves the configured seek rate after ABORT MOTION (Ctrl-X) and Unlock (M999)', async () => {
    const sim = await connectSmoothieIdle();
    const frame = useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, FRAME_FEED)
      .catch(() => undefined);
    for (let t = 0; t < 1_000 && !sim.outbound().some((l) => /^G0 .*F/.test(l)); t += 1) {
      await pump(10);
    }
    // The Live Motion bar's ABORT MOTION: Ctrl-X halts the board mid-leg.
    const stop = useLaserStore
      .getState()
      .stopJob()
      .catch(() => undefined);
    await pump(3_000);
    await stop;
    await frame;
    expect(sim.state().isHalted).toBe(true);
    const unlock = useLaserStore
      .getState()
      .unlockAlarm()
      .catch(() => undefined);
    await pump(3_000);
    await unlock;
    expect(sim.state().isHalted).toBe(false);
    expect(sim.outbound()).not.toContain('M121\n');

    // Robot has no halt handler, so neither Ctrl-X nor M999 pops the Frame's
    // M120. Fails today: the board still seeks at the framing feed.
    expect(sim.state().seekRate).toBe(DEFAULT_SEEK_RATE);
  });
});
