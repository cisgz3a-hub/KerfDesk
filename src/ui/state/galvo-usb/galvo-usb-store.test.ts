// The galvo USB store driven against the scripted LMC board (ADR-704), which
// stands in for an ADR-702 USB session: Connect initialises the board as
// MeerK40t's init_laser does, Start is refused until a red-light Frame of the
// same footprint completed, Start's program decodes on the board to the job's
// marks, Abort sends Stop Execute, status reads Get List Status, and Pause /
// Resume are Stop List / Restart List. Simulator evidence only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JczLmcSimulator,
  type JczSimulatorScript,
} from '../../../__fixtures__/controllers/jcz-lmc-simulator';
import type { DeviceProfile } from '../../../core/devices';
import { GENERIC_JCZ_GALVO_PROFILES } from '../../../core/devices/galvo-profiles';
import type { CutGroup } from '../../../core/job';
import { encodeLmcJob } from '../../../core/controllers/jcz/lmc-encoder';
import { encodeLmcFrameJob } from '../../../core/controllers/jcz/lmc-frame-job';
import {
  LMC_ENABLE_LASER,
  LMC_EXECUTE_LIST,
  LMC_FIBER_SET_MO,
  LMC_GET_SERIAL_NO,
  LMC_GET_VERSION,
  LMC_RESET,
  LMC_RESTART_LIST,
  LMC_STOP_EXECUTE,
  LMC_STOP_LIST,
  LMC_WRITE_COR_LINE,
  LMC_WRITE_COR_TABLE,
  LMC_WRITE_PORT,
} from '../../../core/controllers/jcz/lmc-opcodes';
import { galvoTiming } from './galvo-usb-run';
import { GALVO_FRAME_FIRST } from './galvo-usb-messages';
import { resetGalvoUsbStoreForTests, useGalvoUsbStore, type GalvoUsbJob } from './galvo-usb-store';
import type { GalvoUsbAdapter } from './galvo-usb-types';
import { activeLinkMachineWork, resetLinkMachineWorkForTests } from '../link-machine-work';

const DEVICE = GENERIC_JCZ_GALVO_PROFILES[0] as DeviceProfile;

function job(x = 0): GalvoUsbJob {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power: 40,
    speed: 30000,
    passes: 1,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x, y: 0 },
          { x: x + 10, y: 0 },
          { x: x + 10, y: 10 },
        ],
        closed: false,
      },
    ],
  };
  const encoded = encodeLmcJob({ groups: [group] }, DEVICE, { layers: [] });
  if (!encoded.ok) throw new Error('refused');
  const frame = encodeLmcFrameJob(encoded.program.footprint, DEVICE.galvo!, DEVICE.bedWidth);
  if (frame === null) throw new Error('no frame');
  return { program: encoded.program, frame, advisories: ['a warning'] };
}

function adapterFor(sim: JczLmcSimulator): GalvoUsbAdapter {
  return { request: async () => sim, reopen: async () => sim };
}

async function connected(script: JczSimulatorScript = {}): Promise<JczLmcSimulator> {
  const sim = new JczLmcSimulator(script);
  await useGalvoUsbStore.getState().connect(adapterFor(sim), null);
  expect(useGalvoUsbStore.getState().phase).toBe('idle');
  return sim;
}

const state = () => useGalvoUsbStore.getState();
const savedTiming = { ...galvoTiming };

beforeEach(() => {
  galvoTiming.pollMs = 0;
  galvoTiming.sleep = () => new Promise((resolve) => setTimeout(resolve, 0));
  resetGalvoUsbStoreForTests();
  resetLinkMachineWorkForTests();
});

afterEach(() => {
  Object.assign(galvoTiming, savedTiming);
  resetGalvoUsbStoreForTests();
});

describe('galvo USB store', () => {
  it('initialises the board on Connect as MeerK40t’s init_laser does', async () => {
    const sim = await connected();
    expect(sim.singles.slice(0, 5).map((command) => command.opcode)).toEqual([
      LMC_GET_SERIAL_NO,
      LMC_GET_VERSION,
      LMC_RESET,
      LMC_WRITE_COR_TABLE,
      LMC_ENABLE_LASER,
    ]);
    expect(sim.sent(LMC_WRITE_COR_TABLE)[0]?.params[0]).toBe(0);
    expect(state().board?.serial).toBe('4b44000100020003');
  });

  it('sends a .cor table as Write Cor Table 1 and 4225 Write Cor Lines', async () => {
    const sim = new JczLmcSimulator();
    const table = Array.from({ length: 4225 }, (_, index) => [index % 7, 0x8001] as const);
    await state().connect(adapterFor(sim), table);
    expect(sim.sent(LMC_WRITE_COR_TABLE)[0]?.params[0]).toBe(1);
    const lines = sim.sent(LMC_WRITE_COR_LINE);
    expect(lines).toHaveLength(4225);
    expect(lines[0]?.params.slice(0, 3)).toEqual([0, 0x8001, 0]);
    expect(lines[1]?.params.slice(0, 3)).toEqual([1, 0x8001, 1]);
  });

  it('refuses Start until a red-light Frame of the same footprint completed', async () => {
    const sim = await connected();
    await state().start(job());
    expect(state().message).toBe(GALVO_FRAME_FIRST);
    expect(sim.lists).toHaveLength(0);
    await state().frame(job());
    expect(state().framed).toEqual(job().program.footprint);
    // The frame never raised the program bit or opened the fiber oscillator.
    expect(sim.sent(LMC_FIBER_SET_MO).every((command) => command.params[0] === 0)).toBe(true);
    expect(sim.sent(LMC_WRITE_PORT).every((command) => (command.params[0] & 1) === 0)).toBe(true);
    expect(sim.completed[0]?.ops.some((op) => op.op === 'mark')).toBe(false);
    // The job moved: its footprint is no longer the framed one.
    await state().start(job(5));
    expect(state().message).toBe(GALVO_FRAME_FIRST);
  });

  it('runs the framed job: the board marks exactly the encoded program, then closes its outputs', async () => {
    const sim = await connected();
    await state().frame(job());
    await state().start(job());
    expect(state().phase).toBe('idle');
    expect(state().message).toContain('Job finished');
    const marked = sim.completed[1]?.ops.filter((op) => op.op === 'mark') ?? [];
    expect(marked).toHaveLength(2);
    expect(sim.sent(LMC_FIBER_SET_MO).map((command) => command.params[0])).toContain(1);
    expect(sim.masterOscillatorOpen).toBe(false);
    expect(sim.portBits).toBe(0);
  });

  it('reads Get List Status while a Frame runs, and an aborted Frame does not count', async () => {
    const sim = await connected({ runReads: 1_000_000 });
    const framing = state().frame(job());
    await vi.waitFor(() => expect(state().listState).toBe('running'));
    expect(state().phase).toBe('framing');
    await state().abort();
    await framing;
    expect(sim.sent(LMC_STOP_EXECUTE)).toHaveLength(1);
    expect(state().framed).toBeNull();
  });

  it('pauses, resumes and aborts a running job', async () => {
    const sim = await connected();
    await state().frame(job());
    sim.setRunReads(1_000_000);
    const started = state().start(job());
    await vi.waitFor(() => expect(sim.isRunning).toBe(true));
    await vi.waitFor(() => expect(state().listState).toBe('running'));
    // The app-wide guards (Ctrl+., close, Update) see the galvo job.
    expect(activeLinkMachineWork()).toMatchObject({ controller: 'Galvo', activity: 'running' });
    await state().pause();
    expect(state().phase).toBe('paused');
    expect(activeLinkMachineWork()?.activity).toBe('paused');
    expect(sim.sent(LMC_STOP_LIST)).toHaveLength(1);
    expect(sim.isPaused).toBe(true);
    await state().resume();
    expect(state().phase).toBe('running');
    expect(sim.sent(LMC_RESTART_LIST)).toHaveLength(1);
    await state().abort();
    await started;
    expect(sim.sent(LMC_STOP_EXECUTE)).toHaveLength(1);
    expect(sim.stopped).toHaveLength(1);
    expect(sim.isRunning).toBe(false);
    expect(state().phase).toBe('idle');
    expect(state().message).toContain('Stop Execute acknowledged');
    expect(activeLinkMachineWork()).toBeNull();
    expect(sim.sent(LMC_EXECUTE_LIST).length).toBeGreaterThanOrEqual(2);
  });

  it('says a held program may keep running when the board is unplugged mid-job', async () => {
    const sim = await connected();
    await state().frame(job());
    sim.setRunReads(1_000_000);
    void state().start(job());
    await vi.waitFor(() => expect(sim.isRunning).toBe(true));
    sim.unplug();
    expect(state().phase).toBe('disconnected');
    expect(state().message).toContain('may keep running');
  });
});
