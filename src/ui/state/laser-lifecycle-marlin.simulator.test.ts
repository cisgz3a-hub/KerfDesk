// Marlin lifecycle characterization against the scripted Marlin simulator:
// the full workflow with NO realtime bytes — queued M114 status, ping-pong
// streaming, stream-side pause, stop via beam-off lines, text errors.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMarlinSimulator,
  type CreateMarlinSimulatorOptions,
  type MarlinSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
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

async function connectMarlin(options: CreateMarlinSimulatorOptions = {}): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator(options);
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await pump(20); // `start` banner → handshake (no settings query on Marlin)
  return sim;
}

async function connectMarlinIdle(
  options: CreateMarlinSimulatorOptions = {},
): Promise<MarlinSimulator> {
  const sim = await connectMarlin(options);
  await pump(1100); // idle-cadence M114 poll
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function jobLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `G1 X${i} Y1 F600 S200`).join('\n');
}

describe('Marlin lifecycle against the simulator', () => {
  it('connects at 250000 baud, detects Marlin, and never sends $$', async () => {
    const sim = await connectMarlin();
    const s = useLaserStore.getState();
    expect(s.connection.kind).toBe('connected');
    expect(s.detectedControllerKind).toBe('marlin');
    expect(s.activeControllerKind).toBe('marlin');
    expect(s.capabilities).toMatchObject({ realtimePause: false, wcs: 'none', settings: 'none' });
    expect(sim.port.openRequests()).toEqual([{ baudRate: 250000 }]);
    expect(sim.outbound().some((w) => w.includes('$$'))).toBe(false);
  });

  it('polls position with queued M114 while idle and feeds the DRO', async () => {
    const sim = await connectMarlinIdle();
    expect(sim.outbound()).toContain('M114\n');
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('jogs via G91/G0/G90 and clears the operation from M114 idle reports', async () => {
    const sim = await connectMarlinIdle();
    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });
    expect(sim.outbound().at(-1)).toBe('G91\nG0 X10.000 F1000\nG90\n');
    expect(useLaserStore.getState().motionOperation?.kind).toBe('jog');
    await pump(1000);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(sim.state().pos.x).toBe(10);
  });

  it('frames with absolute G0 legs dispatched between idle reports', async () => {
    const sim = await connectMarlinIdle();
    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    await pump(8000);
    const legs = sim.outbound().filter((w) => w.startsWith('G0 X'));
    expect(legs).toHaveLength(5);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('homes with G28 X Y and settles via M400', async () => {
    const sim = await connectMarlinIdle();
    const home = useLaserStore.getState().home();
    await pump(1500);
    await home;
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(sim.outbound()).toContain('G28 X Y\n');
    expect(sim.outbound()).toContain('M400\n');
    expect(sim.state().isHomed).toBe(true);
  });

  it('streams ping-pong: one line per ok, completes, and settles', async () => {
    const sim = await connectMarlinIdle();
    const gcode = 'G21\nG90\nM3 S0\nG1 X10 Y0 F600 S100\nG1 X10 Y5 F600 S100\nM5\n';
    await useLaserStore.getState().startJob(gcode, { streamingMode: 'ping-pong' });
    expect(useLaserStore.getState().streamer?.streamingMode).toBe('ping-pong');
    await pump(4000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().pos).toEqual({ x: 10, y: 5, z: 0 });
    // Ping-pong means every job write is a single line.
    const jobWrites = sim.outbound().filter((w) => /^(G2[19]|G9[01]|M[35]|G1 )/.test(w));
    for (const write of jobWrites) {
      expect(write.trim().split('\n')).toHaveLength(1);
    }
  });

  it('pauses stream-side (no ! byte) and resumes to completion', async () => {
    const sim = await connectMarlinIdle();
    await useLaserStore.getState().startJob(jobLines(40), { streamingMode: 'ping-pong' });
    await pump(30);
    await useLaserStore.getState().pauseJob();
    expect(sim.outbound()).not.toContain('!');
    await pump(50);
    const paused = useLaserStore.getState().streamer;
    expect(paused?.status).toBe('paused');
    expect(paused?.completed).toBeGreaterThan(0);
    expect(paused?.completed).toBeLessThan(40);
    await useLaserStore.getState().resumeJob();
    expect(sim.outbound()).not.toContain('~');
    await pump(8000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().pos.x).toBe(39);
  });

  it('stops with beam-off lines instead of a soft-reset byte', async () => {
    const sim = await connectMarlinIdle();
    await useLaserStore.getState().startJob(jobLines(40), { streamingMode: 'ping-pong' });
    await pump(20);
    await useLaserStore.getState().stopJob();
    await pump(50);
    expect(sim.outbound()).not.toContain('\x18');
    expect(sim.outbound()).toContain('M5\n');
    expect(sim.outbound()).toContain('M107\n');
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });

  it('treats a text Error: as terminal, fires beam-off cleanup, auto-releases at Idle', async () => {
    const sim = await connectMarlinIdle({
      rejectLines: [{ pattern: /X13\b/, error: 'Unknown command' }],
    });
    await useLaserStore.getState().startJob(jobLines(30), { streamingMode: 'ping-pong' });
    await pump(50);
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
    expect(sim.outbound()).toContain('M107\n');
    expect(sim.outbound()).not.toContain('\x18');
    // With no alarm state on Marlin, the errored stream releases at the next
    // Idle report from the resumed M114 polls — no manual unlock step exists.
    await pump(600);
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('sends console M115 and logs the firmware identity', async () => {
    const sim = await connectMarlinIdle();
    const send = useLaserStore.getState().sendConsoleCommand('M115');
    await pump(50);
    await send;
    expect(sim.outbound()).toContain('M115\n');
    expect(useLaserStore.getState().log.some((l) => l.includes('FIRMWARE_NAME:Marlin'))).toBe(true);
  });

  it('blocks console M500 (persistent write) with a reason', async () => {
    await connectMarlinIdle();
    await expect(useLaserStore.getState().sendConsoleCommand('M500')).rejects.toThrow(
      /persistent firmware settings/i,
    );
  });
});
