import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMarlinSimulator,
  type CreateMarlinSimulatorOptions,
  type MarlinSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { laserCountdownTestHandoff } from './laser-countdown-test-handoff';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// No synchronizing footer: the move's ACK leaves buffered motion for M400.
const BUFFERED_MOTION_JOB = 'G1 X10 Y0 F600 S100\n';
const INLINE_OFF_JOB = `M3 I S0\n${BUFFERED_MOTION_JOB}M5 I\n`;
const MARLIN_COUNTDOWN_RETENTION_KEY = 'marlin-countdown';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useLaserStore.setState({ autofocusBusy: false });
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
    autofocusBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    liveCanvasRun: null,
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    frameVerification: null,
    homingState: 'unknown',
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectMarlinIdle(
  options: CreateMarlinSimulatorOptions = {},
): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator(options);
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await pump(20);
  await pump(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

async function startCountdownJob(gcode: string): Promise<void> {
  await startTestLaserJob(gcode, {
    streamingMode: 'ping-pong',
    ...laserCountdownTestHandoff({
      gcode,
      retentionKey: MARLIN_COUNTDOWN_RETENTION_KEY,
      capability: 'settle-only',
    }),
  });
}

describe('Marlin countdown settlement against the simulator', () => {
  it('uses M400, never the GRBL dwell, and completes only after Marlin settles', async () => {
    const sim = await connectMarlinIdle({ motionMs: 2_000 });
    await startCountdownJob(BUFFERED_MOTION_JOB);

    await pump(100);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: { kind: 'post-job-settle', phase: 'dwell' },
      liveCanvasRun: { timing: { kind: 'running' } },
    });
    expect(sim.state().pendingMotions).toBe(1);
    expect(sim.outbound()).toContain('M400\n');
    expect(sim.outbound()).not.toContain('G4 P0.01\n');

    await pump(4_000);
    expect(sim.state().pendingMotions).toBe(0);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      liveCanvasRun: { timing: { kind: 'complete' } },
    });
  });

  it('waits for motion before acknowledging native M5 I and completing the stream', async () => {
    const sim = await connectMarlinIdle({ motionMs: 2_000 });
    await startCountdownJob(INLINE_OFF_JOB);

    await pump(100);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'streaming', completed: 2, inFlight: [{ line: 'M5 I\n' }] },
      controllerOperation: null,
      liveCanvasRun: { timing: { kind: 'running' } },
    });
    expect(sim.state()).toMatchObject({
      pendingMotions: 1,
      laserMode: 'continuous',
      inlineBurnPowers: [100],
    });
    expect(sim.outbound()).toContain('M5 I\n');
    expect(sim.outbound()).not.toContain('M400\n');

    await pump(1_880);
    expect(sim.state().pendingMotions).toBe(1);
    expect(useLaserStore.getState().streamer?.completed).toBe(2);
    expect(sim.outbound()).not.toContain('M400\n');

    await pump(40);
    expect(sim.state()).toMatchObject({ pendingMotions: 0, laserMode: 'standard' });
    expect(sim.outbound()).toContain('M400\n');

    await pump(2_000);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      liveCanvasRun: { timing: { kind: 'complete' } },
    });
  });

  it('keeps a failed M400 settlement unavailable after later position reports', async () => {
    const sim = await connectMarlinIdle({
      rejectLines: [{ pattern: /^M400$/, error: 'Unknown command' }],
    });
    await startCountdownJob(BUFFERED_MOTION_JOB);

    await pump(100);
    expect(sim.outbound()).toContain('M400\n');
    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: null,
      liveCanvasRun: {
        timing: {
          kind: 'unavailable',
          reason: 'controller completion settlement could not be confirmed',
        },
      },
    });

    await pump(2_000);
    expect(useLaserStore.getState().liveCanvasRun?.timing).toEqual({
      kind: 'unavailable',
      reason: 'controller completion settlement could not be confirmed',
    });
  });

  it('settles a paused stream whose final acknowledgement arrived before Resume', async () => {
    const sim = await connectMarlinIdle({ motionMs: 2_000 });
    await startCountdownJob(BUFFERED_MOTION_JOB);

    await useLaserStore.getState().pauseJob();
    await pump(20);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'paused', completed: 1, inFlight: [] },
      liveCanvasRun: { timing: { kind: 'paused' } },
    });

    await useLaserStore.getState().resumeJob();
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: { kind: 'post-job-settle', phase: 'dwell' },
      liveCanvasRun: { timing: { kind: 'running' } },
    });
    expect(sim.outbound()).toContain('M400\n');

    await pump(4_000);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      liveCanvasRun: { timing: { kind: 'complete' } },
    });
  });
});
