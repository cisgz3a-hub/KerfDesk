// Pause and lift (ADR-411) against the scripted GRBL simulator: the real store
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
import {
  RT_FEED_OV_MINUS_10,
  RT_SPINDLE_OV_MINUS_10,
  type RealtimeOverrideByte,
} from '../../core/controllers/grbl';
import { cncPauseLiftSkipReason } from './cnc-pause-lift-state';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { currentStreamResetMayLosePosition } from './job-stop-request';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const SEGMENTS = 20;

function cncProgram(segments: number, spinup: ReadonlyArray<string> = ['G4 P1']): string {
  return [
    'G21',
    'G90',
    'G0 Z5',
    'M3 S12000',
    ...spinup,
    'G0 X0 Y0',
    'G1 Z-1 F150',
    ...Array.from({ length: segments }, (_, index) => `G1 X${index + 1} F600`),
    'G0 Z5',
    'M5',
  ].join('\n');
}

const PROGRAM = cncProgram(SEGMENTS);
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
    cncPauseLiftJob: null,
    ovCache: null,
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
    // The bit was parked, so pass recovery may keep the position.
    expect(currentStreamResetMayLosePosition(useLaserStore.getState())).toBe(false);
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });

  it('records that an Abort during the lift move may have cost position', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(PROGRAM);
    await pump(1500);
    const pausing = useLaserStore.getState().pauseJob();
    pausing.catch(() => undefined);
    for (let waited = 0; waited < 5_000 && !sim.outbound().includes('G0 Z5.000\n'); waited += 5) {
      await pump(5);
    }
    expect(useLaserStore.getState().cncPauseLift?.phase).toBe('lifting');

    await settle(useLaserStore.getState().stopJob());
    await settle(pausing);
    expect(currentStreamResetMayLosePosition(useLaserStore.getState())).toBe(true);
    expect(useLaserStore.getState().cncPauseLift ?? null).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
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
    // The refused lift line never ran and nothing else was moving.
    expect(currentStreamResetMayLosePosition(state)).toBe(false);
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

// ADR-411 Amendment 1: the re-audit's gaps in the lift itself.
describe('CNC Pause and lift, re-audit fixes', () => {
  it('lifts again on a second Pause in the same job', async () => {
    const segments = 60;
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(cncProgram(segments));
    await pump(1500);
    await settle(useLaserStore.getState().pauseJob());
    expect(useLaserStore.getState().cncPauseLift?.phase).toBe('lifted');
    await settle(useLaserStore.getState().resumeJob());
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    await pump(1500);

    await settle(useLaserStore.getState().pauseJob());
    const second = useLaserStore.getState();
    // The first lift's reset cleared the settings KerfDesk read on connect.
    expect(second.controllerSettings).toBeNull();
    expect(second.cncPauseLift?.phase).toBe('lifted');
    expect(second.log.some((line) => line.includes('Paused without lifting'))).toBe(false);
    expect(sim.outbound().filter((write) => write === '\x18')).toHaveLength(2);
    expect(sim.state().mpos.z).toBe(5);
    expect(sim.state().spindle).toBe(0);

    await settle(useLaserStore.getState().resumeJob());
    await pump(20_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(sim.state().mpos).toEqual({ x: segments, y: 0, z: 5 });
  });

  it('puts feed and spindle overrides back after the lift reset', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(PROGRAM);
    const slower: RealtimeOverrideByte[] = [
      RT_FEED_OV_MINUS_10,
      RT_FEED_OV_MINUS_10,
      RT_FEED_OV_MINUS_10,
      RT_SPINDLE_OV_MINUS_10,
      RT_SPINDLE_OV_MINUS_10,
    ];
    for (const byte of slower) await useLaserStore.getState().sendRealtimeOverride(byte);
    await pump(1500);
    expect(useLaserStore.getState().ovCache).toEqual({ feed: 70, rapid: 100, spindle: 80 });

    await settle(useLaserStore.getState().pauseJob());
    const lifted = useLaserStore.getState();
    expect(lifted.cncPauseLift?.phase).toBe('lifted');
    expect(sim.state().overrides).toEqual({ feed: 70, rapid: 100, spindle: 80 });
    expect(lifted.ovCache).toEqual({ feed: 70, rapid: 100, spindle: 80 });
    expect(
      lifted.log.some((line) =>
        line.includes('overrides put back to feed 70%, rapid 100%, spindle 80%'),
      ),
    ).toBe(true);
    // The reset put them to 100% before the lift set them again.
    const reset = indexOfWrite(sim, '\x18');
    const restore = sim.outbound().findIndex((write, i) => i > reset && write.startsWith('\x90'));
    expect(restore).toBeGreaterThan(indexOfWrite(sim, 'G0 Z5.000\n', reset));
  });

  it('lifts a program with no spin-up dwell and waits the default spin-up above the cut', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(cncProgram(SEGMENTS, []));
    await pump(1500);
    await settle(useLaserStore.getState().pauseJob());
    expect(useLaserStore.getState().cncPauseLift?.phase).toBe('lifted');

    const beforeResume = sim.outbound().length;
    await settle(useLaserStore.getState().resumeJob());
    const reentry = sim
      .outbound()
      .slice(beforeResume)
      .filter((write) => write !== '?');
    expect(reentry.slice(2, 4)).toEqual(['M3 S12000\n', 'G4 P4\n']);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });

  it('says why a Pause with the door open did not lift, and lifts on Resume once it closes', async () => {
    const sim = await connectCnc({ settings: CNC_SETTINGS });
    await startCnc(PROGRAM);
    await pump(1500);
    const pausing = useLaserStore.getState().pauseJob();
    sim.setDoorInput(true);
    await settle(pausing);
    const paused = useLaserStore.getState();
    expect(paused.cncPauseLift ?? null).toBeNull();
    expect(paused.streamer?.status).toBe('paused');
    expect(cncPauseLiftSkipReason(paused)).toBe('The door input is open.');
    expect(sim.outbound()).not.toContain('\x18');

    sim.setDoorInput(false);
    await pump(500);
    const beforeResume = sim.outbound().length;
    await settle(useLaserStore.getState().resumeJob());
    const resumed = sim
      .outbound()
      .slice(beforeResume)
      .filter((write) => write !== '?');
    expect(resumed[0]).toBe('\x18');
    expect(resumed).toContain('G0 Z5.000\n');
    expect(resumed).toContain('M3 S12000\n');
    expect(resumed).not.toContain('~');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(cncPauseLiftSkipReason(useLaserStore.getState())).toBeNull();
  });
});
