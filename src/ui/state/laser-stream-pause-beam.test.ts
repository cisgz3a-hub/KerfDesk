// Controller audit MA-1: a stream-side Pause on Marlin only stopped sending,
// so a lit fan-wired laser burned the stopped head with no timeout
// (planner.cpp L1388-L1399), and an inline beam stayed on until
// LASER_SAFETY_TIMEOUT_MS or for good (stepper.cpp L2341-L2346). Pause now
// queues the job's own beam-off behind the buffered motion, and Resume
// switches the beam back on in the job's own commands (ADR-364's rules).
// The oracle is marlin-laser-power-model.ts, ported from the upstream rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import {
  powerUpMarlin,
  runMarlinLines,
  type MarlinBurn,
} from '../../__fixtures__/controllers/marlin-laser-power-model';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { useLaserStore } from './laser-store';
import { STREAM_PAUSE_RESUME_WAIT_MESSAGE } from './laser-stream-pause-beam';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

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
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function connectMarlinIdle(motionMs: number): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator({ motionMs });
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

// Resume awaits each restore line's `ok`, which the simulator answers on a timer.
async function resume(): Promise<void> {
  const pending = useLaserStore.getState().resumeJob();
  await vi.advanceTimersByTimeAsync(100);
  await pending;
}

async function drainJob(): Promise<void> {
  for (let step = 0; step < 400 && useLaserStore.getState().streamer !== null; step += 1) {
    await vi.advanceTimersByTimeAsync(250);
  }
  expect(useLaserStore.getState().streamer).toBeNull();
}

function burnKeys(burns: ReadonlyArray<MarlinBurn>): string[] {
  return burns.map((burn) => JSON.stringify([burn.from, burn.to, burn.power, burn.source]));
}

describe('a Marlin stream-side Pause', { timeout: 30_000 }, () => {
  it('fan dialect: switches the fan-wired laser off and restores it right before the next move', async () => {
    const program = marlinStrategy.emit(CUT_JOB, {
      ...MARLIN_DEVICE,
      gcodeDialect: { dialectId: 'marlin-fan' },
    });
    const sim = await connectMarlinIdle(3_000);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });

    expect(await pauseWhenInFlight(/^M106 S[1-9]/)).toBe('M106 S128');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(sim.state()).toMatchObject({ pendingMotions: 0, fanPower: 0 });
    expect(sim.outbound()).toContain('M107\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    const before = sim.outbound().length;
    await resume();
    expect(sim.outbound().slice(before, before + 2)).toEqual([
      'M106 S128\n',
      'G1 X60.000 Y10.000 F600\n',
    ]);
    await drainJob();
    expect(burnKeys(sim.state().burns)).toEqual(
      burnKeys(runMarlinLines(powerUpMarlin(), program).burns),
    );
  });

  it('inline dialect: switches the beam off with M5 I and re-arms it with the held power', async () => {
    const program = marlinStrategy.emit(CUT_JOB, MARLIN_DEVICE);
    const sim = await connectMarlinIdle(3_000);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });

    // Pause right after a burn move with an explicit S word.
    const paused = await pauseWhenInFlight(/^G1 .*S[1-9]/);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(sim.state().pendingMotions).toBe(0);
    // Replay what the controller received through the upstream-derived power
    // model: the output with the planner empty.
    const received = sim
      .outbound()
      .flatMap((write) => write.split('\n'))
      .filter((line) => line.trim() !== '' && !/^M114\b/.test(line));
    const model = runMarlinLines(powerUpMarlin(), received);
    expect(model.output).toBe(0);
    expect(received.at(-1)).toBe('M5 I');

    const before = sim.outbound().length;
    await resume();
    const held = /S(\d+)/.exec(paused)?.[1] ?? '';
    expect(sim.outbound().slice(before, before + 2)).toEqual([
      'M3 I S0\n',
      expect.stringMatching(new RegExp(`^G1 .*S${held}\\n$`)),
    ]);
    await drainJob();
    expect(burnKeys(sim.state().burns)).toEqual(
      burnKeys(runMarlinLines(powerUpMarlin(), program).burns),
    );
  });

  it('refuses Resume until the queued beam-off is acknowledged, without stopping the job', async () => {
    const program = marlinStrategy.emit(CUT_JOB, MARLIN_DEVICE);
    const sim = await connectMarlinIdle(3_000);
    await startTestLaserJob(program, { streamingMode: 'ping-pong' });
    await pauseWhenInFlight(/^G1 .*S[1-9]/);

    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(
      STREAM_PAUSE_RESUME_WAIT_MESSAGE,
    );
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(sim.outbound()).not.toContain('M410\n');

    await vi.advanceTimersByTimeAsync(8_000);
    await resume();
    await drainJob();
    expect(burnKeys(sim.state().burns)).toEqual(
      burnKeys(runMarlinLines(powerUpMarlin(), program).burns),
    );
  });
});
