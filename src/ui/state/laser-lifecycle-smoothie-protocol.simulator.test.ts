// Smoothieware protocol regressions (controller audit 2026-09-23, drivers
// cluster). The oracle is the simulator's upstream model of Smoothieware V1
// dispatch (smoothie-sim-shell.ts): which lines SimpleShell answers and with
// what, the G28/G28.2/$H dialect split, and Robot.cpp's separate seek rate.
// Assertions read the firmware model's physical state and the store state an
// operator sees, never the bytes the driver chose to send.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSmoothieSimulator,
  type CreateSmoothieSimulatorOptions,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const DEFAULT_SEEK_RATE = 4000;

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
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
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

async function connectSmoothieIdle(
  options: CreateSmoothieSimulatorOptions = {},
): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator({ defaultSeekRate: DEFAULT_SEEK_RATE, ...options });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(20);
  await pump(1100); // idle-cadence realtime ? poll
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

async function home(): Promise<void> {
  const homing = useLaserStore.getState().home();
  await pump(1000);
  await homing;
}

async function sendConsole(command: string): Promise<void> {
  const send = useLaserStore.getState().sendConsoleCommand(command);
  await pump(50);
  await send;
  await pump(1100);
}

describe('Smoothieware Home runs an endstop cycle in both firmware dialects', () => {
  it.each([
    ['Reprap dialect (grbl_mode false, the stock firmware.bin default)', false],
    ['grbl dialect (grbl_mode true)', true],
  ])('%s', async (_label, grblMode) => {
    const sim = await connectSmoothieIdle({ grblMode });
    await useLaserStore.getState().jog({ dx: 40, dy: 25, feed: 3000 });
    await pump(900);
    expect(sim.state().pos).toMatchObject({ x: 40, y: 25 });

    await home();

    expect(sim.state()).toMatchObject({ homingCycles: 1, parkMoves: 0, isHomed: true });
    expect(useLaserStore.getState().homingState).toBe('confirmed');
  });

  it('treats a console G28.2 as a reference change: it only parks on the stock build', async () => {
    const sim = await connectSmoothieIdle();
    await home();
    expect(useLaserStore.getState().homingState).toBe('confirmed');

    await sendConsole('G28.2');

    expect(sim.state()).toMatchObject({ homingCycles: 1, parkMoves: 1 });
    expect(useLaserStore.getState().homingState).not.toBe('confirmed');
  });
});

describe('Smoothieware shell commands settle their acknowledgement', () => {
  it('settles `version`, which upstream answers with no ok, and keeps jog available', async () => {
    const sim = await connectSmoothieIdle();
    await sendConsole('version');
    expect(useLaserStore.getState().log.some((line) => line.includes('Build version'))).toBe(true);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    await useLaserStore.getState().jog({ dx: 5, feed: 1000 });
    await pump(900);
    expect(sim.state().pos.x).toBe(5);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('keeps Machine Setup read-only checks (version, then M114) from stranding Home', async () => {
    const sim = await connectSmoothieIdle();
    await sendConsole('version');
    await sendConsole('M114');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    await home();
    expect(sim.state().homingCycles).toBe(1);
    expect(useLaserStore.getState().homingState).toBe('confirmed');
  });

  it.each(['help', 'mem', 'config-get sd laser_module_maximum_s_value', '$I', '$X', '$J X1'])(
    'refuses `%s`, which Smoothieware answers without an ok, before it reaches the wire',
    async (command) => {
      const sim = await connectSmoothieIdle();
      await expect(useLaserStore.getState().sendConsoleCommand(command)).rejects.toThrow(
        /without an ok|M999/,
      );
      await pump(1100);
      expect(sim.outbound()).not.toContain(`${command}\n`);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    },
  );

  it('sends the shell queries Smoothieware acknowledges ($G, $#)', async () => {
    const sim = await connectSmoothieIdle();
    await sendConsole('$G');
    await sendConsole('$#');
    expect(sim.outbound()).toEqual(expect.arrayContaining(['$G\n', '$#\n']));
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});

describe('Smoothieware console M115 is an identity read, not a reboot', () => {
  it('keeps session, Home and origin evidence', async () => {
    const sim = await connectSmoothieIdle();
    await home();
    await useLaserStore.getState().jog({ dx: 12, feed: 1000 });
    await pump(900);
    const setOrigin = useLaserStore.getState().setOriginHere();
    await pump(100);
    await setOrigin;
    await pump(1100);
    const before = useLaserStore.getState();
    expect(before).toMatchObject({ workOriginSource: 'g92', homingState: 'confirmed' });

    await sendConsole('M115');

    const after = useLaserStore.getState();
    expect(sim.outbound()).toContain('M115\n');
    expect(after.log.some((line) => line.startsWith('FIRMWARE_NAME:Smoothieware'))).toBe(true);
    expect(after).toMatchObject({
      controllerSessionEpoch: before.controllerSessionEpoch,
      trustedPositionEpoch: before.trustedPositionEpoch,
      homingState: 'confirmed',
      workOriginActive: true,
      workOriginSource: 'g92',
      pendingUntrackedAcks: 0,
      controllerOperation: null,
    });
  });
});

describe('Smoothieware manual motion leaves the G0 seek rate alone', () => {
  const TRAVEL_JOB = 'G21\nG90\nG0 X30 Y20 S0\nG1 X40 Y20 F600 S100\nG0 X5 Y5 S0\n';

  it('restores the seek rate after a slow jog, so job travel keeps the configured rate', async () => {
    const sim = await connectSmoothieIdle();
    await useLaserStore.getState().jog({ dx: 10, feed: 100 });
    await pump(900);
    expect(sim.state().seekRate).toBe(DEFAULT_SEEK_RATE);

    const movesBefore = sim.state().seekMoveRates.length;
    await startTestLaserJob(TRAVEL_JOB, { streamingMode: 'ping-pong' });
    await pump(4000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(sim.state().seekMoveRates.slice(movesBefore)).toEqual([
      DEFAULT_SEEK_RATE,
      DEFAULT_SEEK_RATE,
    ]);
  });

  it('restores the seek rate after a Frame at a slow framing feed', async () => {
    const sim = await connectSmoothieIdle();
    const frame = useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 1500);
    await pump(6000);
    await frame;
    expect(useLaserStore.getState().motionOperation).toBeNull();
    // The frame legs themselves ran at the framing feed.
    expect(sim.state().seekMoveRates).toContain(1500);
    expect(sim.state().seekRate).toBe(DEFAULT_SEEK_RATE);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});
