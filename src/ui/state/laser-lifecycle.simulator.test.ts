// Full streaming-lifecycle characterization against the scripted GRBL
// simulator (src/__fixtures__/controllers). These tests drive the REAL
// laser-store — connect/handshake, poll, jog, frame, home, start/pause/
// resume/stop, error:N, alarm recovery, cable yank, origin — and are the
// byte-level safety net for the Phase H ControllerDriver refactor: outbound
// transcripts asserted here must not change when the seam lands.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import type { ConnectControllerOptions } from './laser-store';
import { useLaserStore } from './laser-store';

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Connect the real store to a fresh simulator and let the handshake finish. */
async function connectSim(
  options: CreateGrblSimulatorOptions = {},
  connectOptions: ConnectControllerOptions = {},
): Promise<GrblSimulator> {
  const sim = createGrblSimulator(options);
  await useLaserStore.getState().connect(sim.adapter, connectOptions);
  await pump(20); // banner → $$ harvest → settings collected
  return sim;
}

/** Connect AND wait for the first Idle status poll (jog/frame/origin gates). */
async function connectIdle(options: CreateGrblSimulatorOptions = {}): Promise<GrblSimulator> {
  const sim = await connectSim(options);
  await pump(1100); // idle-cadence poll fires every 1000 ms
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function jobLines(count: number, yValue: number): string {
  return Array.from({ length: count }, (_, i) => `G1 X${i} Y${yValue} F600 S200`).join('\n');
}

describe('laser lifecycle against the GRBL simulator', () => {
  it('connects, handshakes with $$, and detects laser mode from the dump', async () => {
    const sim = await connectSim();
    const s = useLaserStore.getState();
    expect(s.connection.kind).toBe('connected');
    expect(sim.outbound().some((w) => w.includes('$$'))).toBe(true);
    expect(s.controllerSettings?.laserModeEnabled).toBe(true);
    expect(sim.port.openRequests()).toEqual([{ baudRate: 115200 }]);
  });

  it('polls ? on the idle cadence and stores the parsed status report', async () => {
    const sim = await connectIdle();
    expect(sim.outbound()).toContain('?');
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('jogs end-to-end: $J write, Jog observed, operation cleared at Idle', async () => {
    const sim = await connectIdle({ motionMs: 300 });
    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });
    expect(sim.outbound().at(-1)).toBe('$J=G91 G21 X10.000 F1000\n');
    expect(useLaserStore.getState().motionOperation?.kind).toBe('jog');
    await pump(800);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(sim.state().mpos.x).toBe(10);
  });

  it('frames: five absolute $J perimeter jogs dispatched one at a time', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    await pump(6000);
    const frameJogs = sim.outbound().filter((w) => w.startsWith('$J=G90'));
    expect(frameJogs).toHaveLength(5);
    expect(frameJogs[0]).toBe('$J=G90 G21 X0.000 Y0.000 F6000\n');
    expect(frameJogs[2]).toBe('$J=G90 G21 X20.000 Y10.000 F6000\n');
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('homes: $H then settle dwell, confirmed after a fresh Idle', async () => {
    const sim = await connectIdle();
    const home = useLaserStore.getState().home();
    await pump(1000);
    await home;
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(sim.outbound()).toContain('$H\n');
    expect(sim.outbound()).toContain('G4 P0.01\n');
  });

  it('streams a job to completion and releases the streamer after settle', async () => {
    const sim = await connectIdle();
    const gcode = 'G21\nG90\nM3 S0\nG1 X10 Y0 F600 S100\nG1 X10 Y5 F600 S100\nM5\n';
    await useLaserStore.getState().startJob(gcode);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    await pump(3000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(sim.state().mpos).toEqual({ x: 10, y: 5, z: 0 });
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('pauses mid-stream with ! and resumes with ~ to completion', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().startJob(jobLines(40, 1));
    await useLaserStore.getState().pauseJob();
    expect(sim.outbound()).toContain('!');
    await pump(50);
    const paused = useLaserStore.getState().streamer;
    expect(paused?.status).toBe('paused');
    expect(paused?.completed).toBeGreaterThan(0);
    expect(paused?.completed).toBeLessThan(40);
    await useLaserStore.getState().resumeJob();
    expect(sim.outbound()).toContain('~');
    await pump(5000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().mpos.x).toBe(39);
  });

  it('stops mid-job with soft reset; alarm surfaces and $X recovers', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().startJob(jobLines(40, 2));
    await pump(5);
    await useLaserStore.getState().stopJob();
    expect(sim.outbound()).toContain('\x18');
    // M9 is deferred until the boot banner after the reset (audit F2).
    expect(sim.outbound()).not.toContain('M9\n');
    await pump(50);
    expect(sim.outbound()).toContain('M9\n');
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().alarmCode).toBe(3);
    await useLaserStore.getState().unlockAlarm();
    await pump(50);
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(sim.state().locked).toBe(false);
  });

  it('treats a mid-stream error:N as terminal; recovery is Stop, then unlock', async () => {
    const sim = await connectIdle({ rejectLines: [{ pattern: /X13\b/, errorCode: 20 }] });
    await useLaserStore.getState().startJob(jobLines(30, 3));
    await pump(100);
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
    expect(sim.outbound()).toContain('\x18');
    // Characterized: while the streamer is 'errored', $X is gated behind Stop
    // ("A job is active. Press Stop before sending ... unlock ...").
    await expect(useLaserStore.getState().unlockAlarm()).rejects.toThrow(/job is active/i);
    await useLaserStore.getState().stopJob();
    await pump(50);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    await useLaserStore.getState().unlockAlarm();
    await pump(50);
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(sim.state().locked).toBe(false);
  });

  it('auto-releases an errored stream at the next Idle when no alarm follows', async () => {
    const sim = await connectIdle({
      rejectLines: [{ pattern: /X13\b/, errorCode: 20 }],
      alarmOnResetDuringMotion: false,
    });
    await useLaserStore.getState().startJob(jobLines(30, 3));
    await pump(100);
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    expect(sim.outbound()).toContain('\x18');
    await pump(600); // fast poll sees Idle → shouldReleaseStreamerAtIdle
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('cable yank mid-job: disconnected state, streamer marked, notice raised', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().startJob(jobLines(30, 4));
    sim.yankCable();
    await pump(10);
    const s = useLaserStore.getState();
    expect(s.connection.kind).toBe('disconnected');
    expect(s.streamer?.status).toBe('disconnected');
    expect(s.safetyNotice).not.toBeNull();
  });

  it('sets and clears the G92 work origin, cached from WCO status frames', async () => {
    const sim = await connectIdle();
    await useLaserStore.getState().jog({ dx: 12, feed: 1000 });
    await pump(800);
    const setOrigin = useLaserStore.getState().setOriginHere();
    await pump(100);
    await setOrigin;
    expect(sim.outbound().some((w) => w.startsWith('G54 G92 X0 Y0'))).toBe(true);
    await pump(1200);
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 0, z: 0 });
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    const resetOrigin = useLaserStore.getState().resetOrigin();
    await pump(100);
    await resetOrigin;
    await pump(1200);
    expect(useLaserStore.getState().workOriginActive).toBe(false);
  });

  it('sends a console $I through the guarded path and logs the reply', async () => {
    const sim = await connectIdle();
    const send = useLaserStore.getState().sendConsoleCommand('$I');
    await pump(50);
    await send;
    expect(sim.outbound()).toContain('$I\n');
    expect(useLaserStore.getState().log.some((l) => l.includes('[VER:'))).toBe(true);
  });
});

describe('GRBL-family variants against the simulator', () => {
  it('grblHAL: detects the banner and drives the full jog path', async () => {
    const sim = await connectSim(
      { firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]", motionMs: 300 },
      { controllerKind: 'grblhal' },
    );
    expect(useLaserStore.getState().detectedControllerKind).toBe('grblhal');
    expect(useLaserStore.getState().capabilities.settings).toBe('grbl-dollar');
    await pump(1100);
    await useLaserStore.getState().jog({ dx: 5, feed: 1000 });
    expect(sim.outbound().at(-1)).toBe('$J=G91 G21 X5.000 F1000\n');
    await pump(800);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('grblHAL: decodes extended alarm 11 (homing required)', async () => {
    const sim = await connectSim({ firmwareBanner: 'GrblHAL 1.1f' }, { controllerKind: 'grblhal' });
    sim.triggerAlarm(11);
    await pump(20);
    expect(useLaserStore.getState().alarmCode).toBe(11);
  });

  it('FluidNC: detects the banner, streams, and blocks numeric $ writes', async () => {
    const sim = await connectSim(
      { firmwareBanner: "Grbl 3.7 [FluidNC v3.7.8 '$' for help]" },
      { controllerKind: 'fluidnc' },
    );
    expect(useLaserStore.getState().detectedControllerKind).toBe('fluidnc');
    expect(useLaserStore.getState().capabilities.settings).toBe('readonly-dump');
    await pump(1100);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X5 Y0 F600 S100\nM5\n');
    await pump(3000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().mpos.x).toBe(5);
    await expect(useLaserStore.getState().writeGrblSetting(30, '1000')).rejects.toThrow(
      /does not accept numeric \$ setting writes/i,
    );
    expect(sim.outbound()).not.toContain('$30=1000\n');
    await expect(
      useLaserStore.getState().sendConsoleCommand('$30=1000', { confirmed: true }),
    ).rejects.toThrow(/does not accept numeric \$ setting writes/i);
    expect(sim.outbound()).not.toContain('$30=1000\n');
  });

  it('logs an advisory when the banner disagrees with the selected profile', async () => {
    await connectSim(
      { firmwareBanner: "Grbl 3.7 [FluidNC v3.7.8 '$' for help]" },
      { controllerKind: 'grbl-v1.1' },
    );
    const s = useLaserStore.getState();
    expect(s.detectedControllerKind).toBe('fluidnc');
    expect(s.log.some((l) => l.includes('banner looks like fluidnc'))).toBe(true);
  });
});
