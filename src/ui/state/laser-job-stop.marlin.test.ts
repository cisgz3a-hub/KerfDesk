// Controller audit MA-7 and MA-3: Abort on Marlin. It used to stop sending and
// queue `M5 I` + `M107`, which Marlin runs only after every move already in
// its 16-block planner, beam on (about 200 s here). Now ABORT JOB and ABORT
// MOTION send M107, M410 and M5 I, in that order, as ordinary lines: Marlin
// acts on M410 when it reads it and drops the planner without a reset
// (gcode/queue.cpp L538-L545, planner.cpp L1678-L1705). The G92 origin
// survives it (G92.cpp L95-L98), so the origin record is kept, while homing is
// unverified because a quickstop can lose steps (M108_M112_M410.cpp L46-L53).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import { createFifoMarlin } from '../../__fixtures__/controllers/marlin-fifo-model';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { resolveJobPlacement } from '../job-placement';
import { QUICK_STOP_UNCONFIRMED_MESSAGE } from './laser-safety-notice';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

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

// One second of LASER_SAFETY_TIMEOUT_MS / quickstop window, plus margin.
const BEST_MARLIN_STOP_MS = 1_500;

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
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
    homingState: 'unknown',
    log: [],
    transcript: [],
  });
  resetStore();
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

async function connectSimulator(motionMs: number): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator({ motionMs });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('ABORT on Marlin quick-stops the planner', () => {
  it('turns the beam off within about a second after ABORT JOB', async () => {
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

    expect(marlin.beamOnMsSince(abortAt)).toBeLessThan(BEST_MARLIN_STOP_MS);
    expect(marlin.state().plannedBlocks).toBe(0);
    expect(useLaserStore.getState()).toMatchObject({
      pendingUntrackedAcks: 0,
      safetyNotice: {
        kind: 'disconnect-stop-unconfirmed',
        message: QUICK_STOP_UNCONFIRMED_MESSAGE,
      },
    });
  });

  it('ABORT MOTION stops a long jog within about a second', async () => {
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
    expect(stoppedAt - abortAt).toBeLessThan(BEST_MARLIN_STOP_MS);
    // The jog's owner is cancelled and released through its settle marker.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('sends M107, M410, M5 I as owed lines and leaves homing unverified', async () => {
    const sim = await connectSimulator(2_000);
    useLaserStore.setState({ homingState: 'confirmed' });
    const epoch = useLaserStore.getState().trustedPositionEpoch ?? 0;
    await startTestLaserJob('M3 I S0\nG1 X10 F600 S100\nG1 X20\nG1 X30\nM5 I\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(20);
    const before = sim.outbound().length;

    await useLaserStore.getState().stopJob();
    expect(sim.outbound().slice(before)).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
    expect(sim.state().pendingMotions).toBe(0);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'cancelled' },
      homingState: 'unknown',
      homingProof: null,
      trustedPositionEpoch: epoch + 1,
    });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBeGreaterThan(0);
    // The job's own M5 I waits out the first quickstop second; the queued M410
    // then runs quickstop_stepper() again and waits a second of its own.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().log.some((line) => line.includes('quick-stopped'))).toBe(true);
  });

  it('keeps the G92 origin record Marlin keeps through M410 (MA-3)', async () => {
    const sim = await connectSimulator(50);
    const setOrigin = useLaserStore.getState().setOriginHere();
    await vi.advanceTimersByTimeAsync(500);
    await setOrigin;
    expect(useLaserStore.getState().workOriginSource).toBe('g92');

    const job = Array.from({ length: 40 }, (_, i) => `G1 X${i} Y1 F600 S200`).join('\n');
    await startTestLaserJob(job, { streamingMode: 'ping-pong' });
    await vi.advanceTimersByTimeAsync(30);
    await useLaserStore.getState().stopJob();
    await vi.advanceTimersByTimeAsync(2_000);

    // No reset byte went out and nothing cleared Marlin's G92 shift.
    expect(sim.outbound()).not.toContain('\x18');
    expect(sim.outbound().some((write) => /^G92\.1\b/m.test(write))).toBe(false);
    const laser = useLaserStore.getState();
    expect(laser.workOriginSource).toBe('g92');
    expect(laser.workOriginActive).toBe(true);
    expect(resolveJobPlacement({ startFrom: 'absolute', anchor: 'front-left' }, laser)).not.toEqual(
      { ok: true },
    );
  });

  it('dispatches none of a Frame’s remaining legs after ABORT MOTION', async () => {
    const sim = await connectSimulator(2_000);
    const frame = useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000)
      .catch(() => undefined);
    for (let elapsed = 0; elapsed < 5_000; elapsed += 10) {
      await vi.advanceTimersByTimeAsync(10);
      if (sim.outbound().some((write) => write.startsWith('G0 X'))) break;
    }
    await useLaserStore.getState().stopJob();
    const legsAtAbort = sim.outbound().filter((write) => write.startsWith('G0 X')).length;
    await vi.advanceTimersByTimeAsync(20_000);
    await frame;
    expect(sim.outbound().filter((write) => write.startsWith('G0 X'))).toHaveLength(legsAtAbort);
    expect(legsAtAbort).toBeLessThan(5);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });
});
