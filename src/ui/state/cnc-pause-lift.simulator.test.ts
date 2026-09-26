// Pause and lift (ADR-401) against the scripted GRBL simulator: the real store
// pauses a CNC job with the door byte, soft-resets the settled hold, restores
// the G92 origin the reset dropped, lifts the bit, and on Resume spins up
// above the cut, plunges back into its own kerf and replays the stream.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const SEGMENTS = 20;
const PROGRAM = [
  'G21',
  'G90',
  'G0 Z5',
  'M3 S12000',
  'G4 P1',
  'G0 X0 Y0',
  'G1 Z-1 F150',
  ...Array.from({ length: SEGMENTS }, (_, index) => `G1 X${index + 1} F600`),
  'G0 Z5',
  'M5',
].join('\n');
const CNC_SETTINGS: CreateGrblSimulatorOptions['settings'] = [[32, '0']];
const ORIGIN_X = 10;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    controllerOperation: null,
    motionOperation: null,
    streamer: null,
    cncPauseLift: null,
    log: [],
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Pump simulated time until the action settles, then surface its outcome. */
async function settle<T>(action: Promise<T>, limitMs = 30_000): Promise<T> {
  let settled = false;
  const tracked = action.finally(() => {
    settled = true;
  });
  tracked.catch(() => undefined);
  for (let elapsed = 0; elapsed < limitMs && !settled; elapsed += 20) await pump(20);
  return tracked;
}

async function connectCnc(options: CreateGrblSimulatorOptions = {}): Promise<GrblSimulator> {
  const sim = createGrblSimulator({ motionMs: 100, plannerBlocks: 4, ...options });
  await useLaserStore.getState().connect(sim.adapter);
  await pump(20);
  await pump(1100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

/** Move to X10 and make it the G92 origin, which a GRBL reset drops. */
async function setShiftedOrigin(): Promise<void> {
  await settle(useLaserStore.getState().jog({ dx: ORIGIN_X, feed: 1000 }), 2_000);
  await pump(800);
  await settle(useLaserStore.getState().setOriginHere(), 2_000);
  await pump(1200);
  expect(useLaserStore.getState().wcoCache).toEqual({ x: ORIGIN_X, y: 0, z: 0 });
}

async function startCnc(gcode: string): Promise<void> {
  const state = useLaserStore.getState();
  await settle(
    state.startJob(gcode, {
      machineKind: 'cnc',
      cncSetupAttestation: createCncSetupAttestation(gcode, cncControllerEpochOf(state)),
    }),
    5_000,
  );
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

function indexOfWrite(sim: GrblSimulator, write: string, from = 0): number {
  return sim.outbound().indexOf(write, from);
}

describe('CNC Pause and lift against the GRBL simulator', () => {
  it('lifts the paused bit, then spins up above the cut and continues the job', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await setShiftedOrigin();
    await startCnc(PROGRAM);
    await pump(1500);

    await settle(useLaserStore.getState().pauseJob());
    const lifted = useLaserStore.getState();
    expect(lifted.cncPauseLift?.phase).toBe('lifted');
    expect(lifted.streamer?.status).toBe('paused');
    expect(lifted.safetyNotice).toBeNull();
    const stop = lifted.cncPauseLift?.plan.entry;
    expect(stop?.z).toBe(-1);
    expect(sim.state().mpos.z).toBe(5);
    expect(sim.state().spindle).toBe(0);
    expect(lifted.wcoCache).toEqual({ x: ORIGIN_X, y: 0, z: 0 });
    expect(lifted.workOriginActive).toBe(true);
    const door = indexOfWrite(sim, '\x84');
    const reset = indexOfWrite(sim, '\x18', door);
    const modal = indexOfWrite(sim, 'G21 G90 G54 G94 G17\n', reset);
    const origin = sim.outbound().findIndex((write, i) => i > modal && write.startsWith('G92 X'));
    const lift = indexOfWrite(sim, 'G0 Z5.000\n', origin);
    expect([door, reset, modal, origin, lift].every((index) => index >= 0)).toBe(true);
    expect(door < reset && reset < modal && modal < origin && origin < lift).toBe(true);

    const beforeResume = sim.outbound().length;
    await settle(useLaserStore.getState().resumeJob());
    const reentry = sim
      .outbound()
      .slice(beforeResume)
      .filter((write) => write !== '?');
    const entryX = (stop?.x ?? Number.NaN).toFixed(3);
    expect(reentry.slice(0, 7)).toEqual([
      'G21 G90 G54 G94 G17\n',
      'G0 Z5.000\n',
      'M3 S12000\n',
      'G4 P1\n',
      `G0 X${entryX} Y0.000\n`,
      'G1 Z-1.000 F150\n',
      'G1 F600\n',
    ]);
    expect(useLaserStore.getState().cncPauseLift).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    await pump(15_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(sim.state().mpos).toEqual({ x: ORIGIN_X + SEGMENTS, y: 0, z: 5 });
  });

  it('ends a lifted job cleanly on Abort', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(PROGRAM);
    await pump(1500);
    await settle(useLaserStore.getState().pauseJob());
    expect(useLaserStore.getState().cncPauseLift?.phase).toBe('lifted');

    await settle(useLaserStore.getState().stopJob());
    await pump(200);
    expect(useLaserStore.getState().cncPauseLift).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(sim.state().mpos.z).toBe(5);
  });

  it('ends the job with a notice when the lift fails after its reset', async () => {
    const sim = await connectCnc({
      settings: CNC_SETTINGS,
      rejectLines: [{ pattern: /^G0 Z5\.000$/, errorCode: 33 }],
    });
    await startCnc(PROGRAM);
    await pump(1500);
    await settle(useLaserStore.getState().pauseJob());
    await pump(200);

    const state = useLaserStore.getState();
    expect(state.safetyNotice?.kind).toBe('cnc-pause-lift-failed');
    expect(state.safetyNotice?.message).toMatch(/refused "G0 Z5\.000" \(error:33\)/);
    expect(state.cncPauseLift ?? null).toBeNull();
    expect(state.streamer?.status).toBe('cancelled');
    expect(sim.state().spindle).toBe(0);
    expect(sim.outbound().filter((write) => write === '\x18')).toHaveLength(2);
  });

  it('will not re-enter when the work offset moved while the bit was lifted', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(PROGRAM);
    await pump(1500);
    await settle(useLaserStore.getState().pauseJob());
    expect(useLaserStore.getState().cncPauseLift?.phase).toBe('lifted');

    useLaserStore.setState({ wcoCache: { x: 3, y: 0, z: 0 } });
    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(/work offset changed/);
    expect(useLaserStore.getState().cncPauseLift?.phase).toBe('lifted');
    expect(sim.outbound()).not.toContain('M3 S12000\n');
  });

  it('keeps the plain door pause when laser mode is on', async () => {
    const sim = await connectCnc({ settings: [[32, '1']] });
    await startCnc(PROGRAM);
    await pump(1500);
    await settle(useLaserStore.getState().pauseJob());

    const state = useLaserStore.getState();
    expect(state.cncPauseLift ?? null).toBeNull();
    expect(state.streamer?.status).toBe('paused');
    expect(sim.outbound()).not.toContain('\x18');
    expect(
      state.log.some((line) => line.includes('Paused without lifting the bit: Laser mode')),
    ).toBe(true);
  });
});
