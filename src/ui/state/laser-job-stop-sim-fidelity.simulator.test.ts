// Code quality audit C2, D3-P3-7: Abort against the GRBL simulator's motion
// clock, arcs and transport faults. With fixed-time moves reported at their
// end, an arc the simulator ignored and a port whose writes fail only once it
// is closed, none of these could fail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { startTestLaserJobOnClock } from './laser-test-command-control';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(1_000);
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectIdle(options: CreateGrblSimulatorOptions): Promise<GrblSimulator> {
  const sim = createGrblSimulator(options);
  await useLaserStore.getState().connect(sim.adapter);
  await pump(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

async function abort(): Promise<'resolved' | 'rejected' | 'pending'> {
  let outcome: 'resolved' | 'rejected' | 'pending' = 'pending';
  void useLaserStore
    .getState()
    .stopJob()
    .then(
      () => (outcome = 'resolved'),
      () => (outcome = 'rejected'),
    );
  await pump(1_500);
  return outcome;
}

describe('Abort mid-move, with the kinematic motion clock', () => {
  it('leaves the head between the move’s start and its end', async () => {
    const sim = await connectIdle({ kinematic: true });
    // 100 mm at 10 mm/s: the move takes 10 s.
    await startTestLaserJobOnClock('G21\nG90\nM4 S0\nG1 X100 F600 S500\nM5\n');
    await pump(3_000);

    expect(await abort()).toBe('resolved');
    await pump(1_100);

    const stoppedAt = sim.state().mpos.x;
    expect(stoppedAt).toBeGreaterThan(20);
    expect(stoppedAt).toBeLessThan(50);
    expect(useLaserStore.getState().statusReport?.mPos?.x).toBeCloseTo(stoppedAt, 2);
    // The reset stopped the steppers in a move, so position may be lost.
    expect(useLaserStore.getState().alarmCode).toBe(3);
  });

  it('leaves the head on the arc it was cutting', async () => {
    const sim = await connectIdle({ kinematic: true });
    // A half circle of radius 10 about (10, 0), clockwise over the top: 3.14 s.
    await startTestLaserJobOnClock('G21\nG90\nM4 S0\nG2 X20 Y0 I10 J0 F600 S500\nM5\n');
    await pump(1_000);

    expect(await abort()).toBe('resolved');
    await pump(1_100);

    const { x, y } = sim.state().mpos;
    expect(Math.hypot(x - 10, y)).toBeCloseTo(10, 1);
    expect(y).toBeGreaterThan(5);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(20);
    const reported = useLaserStore.getState().statusReport?.mPos;
    expect(reported?.x).toBeCloseTo(x, 2);
    expect(reported?.y).toBeCloseTo(y, 2);
  });
});

describe('Abort whose reset write fails on an open port', () => {
  it('settles, sends no further job line and tells the operator', async () => {
    // A full 15-block planner holds acks back, so the job is still streaming.
    const sim = await connectIdle({ motionMs: 200, plannerBlocks: 15 });
    const program = Array.from({ length: 60 }, (_, i) => `G1 X${i % 20} Y1 F600 S200`);
    await startTestLaserJobOnClock(program.join('\n'), { streamingMode: 'ping-pong' });
    await pump(300);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    sim.port.failWrites((data) => data === '\x18');
    const before = sim.outbound().length;
    const outcome = await abort();
    await pump(2_000);

    expect(outcome).toBe('rejected');
    expect(sim.port.isClosed()).toBe(false);
    expect(
      sim
        .outbound()
        .slice(before)
        .filter((data) => data.startsWith('G1')),
    ).toEqual([]);
    expect(useLaserStore.getState().streamer?.status).not.toBe('streaming');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('write-failed');
  });
});
