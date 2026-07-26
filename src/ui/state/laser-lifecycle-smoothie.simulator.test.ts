// Smoothieware lifecycle characterization: GRBL-style realtime bytes with
// Marlin-style gaps (no $J/$$/$X/$SLP), halt recovery via M999, and — the
// key divergence — realtime pause allowed WITHOUT the $32 laser-mode proof,
// since Smoothie has no $-settings to prove it with.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSmoothieSimulator,
  type CreateSmoothieSimulatorOptions,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { canvasJobTimingPlan } from './canvas-job-timing-plan';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const ORIGIN = { x: 0, y: 0, z: 0 };
const DRAINED_PAUSE_JOB = 'G1 X10 Y0 F600 S100\n';

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

async function connectSmoothie(
  options: CreateSmoothieSimulatorOptions = {},
): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator(options);
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(20);
  return sim;
}

async function connectSmoothieIdle(
  options: CreateSmoothieSimulatorOptions = {},
): Promise<SmoothieSimulator> {
  const sim = await connectSmoothie(options);
  await pump(1100); // idle-cadence realtime ? poll
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function jobLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `G1 X${i} Y1 F600 S200`).join('\n');
}

function countdownCanvasPlan(gcode: string): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, {
      machineKind: 'laser',
      initialPosition: ORIGIN,
    }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'smoothie-countdown',
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: ORIGIN },
    framePerimeter: [],
    jobStart: ORIGIN,
    approachFrom: ORIGIN,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: useLaserStore.getState().trustedPositionEpoch ?? 0,
  };
}

function countdownTimingPlan(gcode: string) {
  const state = useLaserStore.getState();
  return canvasJobTimingPlan(gcode, DEFAULT_DEVICE_PROFILE, ORIGIN, {
    controllerSessionEpoch: state.controllerSessionEpoch,
    positionEpoch: state.trustedPositionEpoch,
    activeControllerKind: state.activeControllerKind,
    detectedControllerKind: state.detectedControllerKind,
  });
}

describe('Smoothieware lifecycle against the simulator', () => {
  it('connects, detects the banner, and skips the settings handshake', async () => {
    const sim = await connectSmoothie();
    const s = useLaserStore.getState();
    expect(s.connection.kind).toBe('connected');
    expect(s.detectedControllerKind).toBe('smoothieware');
    expect(s.capabilities).toMatchObject({
      realtimePause: true,
      settings: 'none',
      wcs: 'g92-only',
    });
    expect(sim.outbound().some((w) => w.includes('$$'))).toBe(false);
  });

  it('polls with realtime ? and parses the Smoothie status format', async () => {
    const sim = await connectSmoothieIdle();
    expect(sim.outbound()).toContain('?');
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('jogs via G21/G91/G0/G90 and observes Run→Idle through status reports', async () => {
    const sim = await connectSmoothieIdle({ motionMs: 300 });
    await useLaserStore.getState().jog({ dx: 7, feed: 900 });
    expect(sim.outbound().at(-1)).toBe('G21\nG91\nG0 X7.000 F900\nG90\n');
    await pump(900);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(sim.state().pos.x).toBe(7);
  });

  it('homes with G28.2 and confirms after fresh Idle', async () => {
    const sim = await connectSmoothieIdle();
    const home = useLaserStore.getState().home();
    await pump(1000);
    await home;
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(sim.outbound()).toContain('G28.2\n');
    expect(sim.state().isHomed).toBe(true);
  });

  it('pauses with realtime ! WITHOUT the $32 proof and resumes with ~', async () => {
    const sim = await connectSmoothieIdle();
    expect(useLaserStore.getState().controllerSettings).toBeNull();
    await startTestLaserJob(jobLines(40), { streamingMode: 'ping-pong' });
    await pump(30);
    await useLaserStore.getState().pauseJob(); // must NOT throw the $32 message
    expect(sim.outbound()).toContain('!');
    await pump(50);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    await useLaserStore.getState().resumeJob();
    expect(sim.outbound()).toContain('~');
    await pump(8000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().pos.x).toBe(39);
  });

  it('resumes timing and settles when the paused final line already acknowledged', async () => {
    const sim = await connectSmoothieIdle({ motionMs: 2_000 });
    await startTestLaserJob(DRAINED_PAUSE_JOB, {
      streamingMode: 'ping-pong',
      canvasPlan: countdownCanvasPlan(DRAINED_PAUSE_JOB),
      jobTimingPlan: countdownTimingPlan(DRAINED_PAUSE_JOB),
    });

    await useLaserStore.getState().pauseJob();
    await pump(20);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'paused', completed: 1, inFlight: [] },
      liveCanvasRun: { timing: { kind: 'paused' } },
    });

    await useLaserStore.getState().resumeJob();
    expect(sim.outbound()).toContain('~');
    expect(sim.outbound()).toContain('M400\n');
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: { kind: 'post-job-settle', phase: 'dwell' },
      liveCanvasRun: { timing: { kind: 'running' } },
    });

    sim.port.emitLine('<Run|MPos:10.0000,0.0000,0.0000|WPos:10.0000,0.0000,0.0000|F:600.0,100.0>');
    expect(useLaserStore.getState()).toMatchObject({
      liveCanvasRun: { lifecycle: 'running', timing: { kind: 'running' } },
    });

    await pump(4_000);
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      liveCanvasRun: { timing: { kind: 'complete' } },
    });
  });

  it('stops with Ctrl-X + M5/M9; halt recovers via M999 unlock', async () => {
    const sim = await connectSmoothieIdle();
    await startTestLaserJob(jobLines(40), { streamingMode: 'ping-pong' });
    await pump(20);
    await useLaserStore.getState().stopJob();
    await pump(50);
    expect(sim.outbound()).toContain('\x18');
    expect(sim.outbound()).toContain('M5\n');
    expect(sim.outbound()).toContain('M9\n');
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(sim.state().isHalted).toBe(true);
    await useLaserStore.getState().unlockAlarm();
    await pump(50);
    expect(sim.outbound()).toContain('M999\n');
    expect(sim.state().isHalted).toBe(false);
  });

  it('uses the available reset before Forget clears an ambiguous physical write', async () => {
    const sim = await connectSmoothieIdle();
    useLaserStore.setState({
      fireActive: false,
      safetyNotice: {
        kind: 'write-failed',
        action: 'fire',
        message: 'Fire command receipt is unknown.',
      },
    });

    await useLaserStore.getState().forgetDevice?.();

    expect(sim.outbound()).toContain('\x18');
    expect(sim.outbound()).toContain('M5\n');
    expect(sim.outbound()).toContain('M9\n');
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      safetyNotice: null,
    });
  });

  it('treats a text error as terminal for the stream', async () => {
    const sim = await connectSmoothieIdle({
      rejectLines: [{ pattern: /X13\b/, error: 'Unknown g code' }],
    });
    await startTestLaserJob(jobLines(30), { streamingMode: 'ping-pong' });
    await pump(100);
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
    expect(sim.outbound()).toContain('\x18'); // realtime abort after stream error
  });

  it('sets and clears the G92 origin (g92-only WCS capability)', async () => {
    const sim = await connectSmoothieIdle();
    await useLaserStore.getState().jog({ dx: 12, feed: 1000 });
    await pump(800);
    const setOrigin = useLaserStore.getState().setOriginHere();
    await pump(100);
    await setOrigin;
    expect(sim.outbound().some((w) => w.startsWith('G92 X0 Y0'))).toBe(true);
    const resetOrigin = useLaserStore.getState().resetOrigin();
    await pump(100);
    await resetOrigin;
    expect(sim.outbound().some((w) => w.startsWith('G92.1'))).toBe(true);
  });

  it('sends console M999 and version through the guarded path', async () => {
    const sim = await connectSmoothieIdle();
    const send = useLaserStore.getState().sendConsoleCommand('version');
    await pump(50);
    await send;
    expect(sim.outbound()).toContain('version\n');
    expect(useLaserStore.getState().log.some((l) => l.includes('Build version'))).toBe(true);
    await expect(
      useLaserStore.getState().sendConsoleCommand('config-set sd foo bar'),
    ).rejects.toThrow(/persistent Smoothie configuration/i);
  });
});
