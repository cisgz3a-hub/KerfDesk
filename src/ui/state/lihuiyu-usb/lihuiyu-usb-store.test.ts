// The Lihuiyu USB store against the simulated board behind its USB session
// (ADR-703), through the real opener and CH341 EPP driver over ADR-702's fake
// USB device: Home, Frame, Start, Pause, Resume and Abort, and the failures a
// link can meet. Simulator-tested only; nothing here touches hardware.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinCollinear } from '../../../__fixtures__/controllers/lihuiyu-decoder';
import { LihuiyuSimulator } from '../../../__fixtures__/controllers/lihuiyu-simulator';
import { encodeLhyJob, lhyBoardSetting } from '../../../core/controllers/lihuiyu/lhy-encoder';
import { lhyFootprint } from '../../../core/controllers/lihuiyu/lhy-frame';
import type { CutGroup } from '../../../core/job';
import type { FakeUsbDevice } from '../../../__fixtures__/usb/fake-usb-device';
import { UsbLinkOpenError, type UsbLinkAdapter } from '../../../platform/usb-link-types';
import { installAbortShortcut } from '../../laser/use-job-shortcuts';
import {
  activeLinkMachineWork,
  anyLinkConnected,
  anyLinkFramed,
  anyMachineJobActive,
  resetLinkMachineWorkForTests,
  useLinkMachineWorkStore,
} from '../link-machine-work';
import { LIHUIYU_FRAME_FIRST, LIHUIYU_HOME_FIRST, lihuiyuLinkLost } from './lihuiyu-usb-messages';
import { LIHUIYU_DRIVER_HELP, lihuiyuUsbOpener } from './lihuiyu-usb-opener';
import { resetLihuiyuUsbStoreForTests, useLihuiyuUsbStore } from './lihuiyu-usb-store';
import type { LihuiyuUsbJob } from './lihuiyu-usb-types';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const store = () => useLihuiyuUsbStore.getState();

/** Resolves on the store update that makes `condition` true. The simulator
 *  answers in microtasks, so a job can stream between two timer ticks; a
 *  subscription sees every update as it happens. */
function until(condition: () => boolean, label: string): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const stop = useLihuiyuUsbStore.subscribe(() => {
      if (condition()) {
        stop();
        resolve();
      } else if (store().phase === 'idle' || store().phase === 'disconnected') {
        stop();
        reject(new Error(`Never saw ${label}; phase ${store().phase}: ${store().message}`));
      }
    });
  });
}

/** A zigzag of `rows` lines, long enough to span many packets. */
function zigzagJob(rows = 12): LihuiyuUsbJob {
  const polyline = Array.from({ length: rows * 2 }, (_, i) => ({
    x: 10 + (Math.floor((i + 1) / 2) % 2) * 40,
    y: 10 + Math.floor(i / 2) * 2,
  }));
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power: 100,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments: [{ polyline, closed: false }],
  };
  const board = lhyBoardSetting('M2');
  const encoded = encodeLhyJob({ groups: [group] }, { board, fullPowerPerMille: 1000 });
  if (!encoded.ok) throw new Error(encoded.error.kind);
  const footprint = lhyFootprint(encoded.motion, { x: 0, y: 0 });
  if (footprint === null) throw new Error('no footprint');
  return {
    stream: encoded.stream,
    footprint,
    absolute: true,
    board,
    framingMmPerMin: 3000,
    advisories: ['M2: power is set on the knob.'],
  };
}

let device: FakeUsbDevice | null = null;

/** Connects the store to the simulated board through the chooser, the opener and the EPP driver. */
async function connectTo(simulator: LihuiyuSimulator): Promise<FakeUsbDevice> {
  const fake = simulator.fakeDevice();
  device = fake;
  const adapter: UsbLinkAdapter = { request: async () => fake.session, reopen: async () => null };
  await store().connect(lihuiyuUsbOpener(adapter), tick);
  return fake;
}

async function connectedHomed(simulator = new LihuiyuSimulator()): Promise<LihuiyuSimulator> {
  await connectTo(simulator);
  expect(store().phase).toBe('idle');
  await store().home();
  expect(store().head).toEqual({ x: 0, y: 0 });
  return simulator;
}

afterEach(() => {
  resetLihuiyuUsbStoreForTests();
  resetLinkMachineWorkForTests();
});

describe('Lihuiyu USB store', () => {
  it('connects, reads status, and refuses Absolute work before Home and Start before Frame', async () => {
    const simulator = new LihuiyuSimulator();
    await connectTo(simulator);
    expect(store().phase).toBe('idle');
    expect(store().statusCode).toBe(206);
    const job = zigzagJob();
    await store().frame(job);
    expect(store().message).toBe(LIHUIYU_HOME_FIRST);
    await store().home();
    await store().start(job);
    expect(store().message).toBe(LIHUIYU_FRAME_FIRST);
    expect(simulator.decoder.burns()).toHaveLength(0);
  });

  it('frames with the laser off, then runs the framed job to the board’s finish', async () => {
    const simulator = await connectedHomed();
    const job = zigzagJob(4);
    await store().frame(job);
    expect(store().phase).toBe('idle');
    expect(store().framed?.footprint).toEqual(job.footprint);
    simulator.drain();
    expect(simulator.decoder.moves.length).toBeGreaterThan(4);
    expect(simulator.decoder.moves.every((move) => !move.laser)).toBe(true);
    await store().start(job);
    simulator.drain();
    expect(store().phase).toBe('idle');
    expect(store().message).toMatch(/finish/);
    const burns = joinCollinear(simulator.decoder.moves).filter((move) => move.laser);
    expect(burns).toHaveLength(7);
    expect([simulator.decoder.x, simulator.decoder.y]).toEqual([0, 0]);
    // The head is back at its start, so the Frame still holds for another run.
    expect(store().framed).not.toBeNull();
  });

  // ADR-703 Amendment 1 (code quality audit C2 D6-P2-1, D6-P2-3): the variable
  // advance runs once the job finishes, never after a Frame, and the link
  // reports its connection and Frame to the app-wide registry the guide reads.
  it('runs the job completion after the job, and reports connected and framed', async () => {
    const simulator = await connectedHomed();
    expect(anyLinkConnected(useLinkMachineWorkStore.getState())).toBe(true);
    const completed = vi.fn();
    const job = { ...zigzagJob(4), completed };
    await store().frame(job);
    simulator.drain();
    expect(anyLinkFramed(useLinkMachineWorkStore.getState())).toBe(true);
    expect(completed).not.toHaveBeenCalled();
    await store().start(job);
    simulator.drain();
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('runs Start → Pause → Resume → Abort against the simulator', async () => {
    const simulator = await connectedHomed();
    const job = zigzagJob(16);
    await store().frame(job);
    const started = store().start(job);
    await until(() => (store().sending?.sent ?? 0) >= 3, 'three packets');
    expect(store().phase).toBe('running');
    expect(store().advisories).toEqual(job.advisories);

    await store().pause();
    expect(store().phase).toBe('paused');
    expect(simulator.paused).toBe(true);
    const heldAt = store().sending?.sent;
    const ranAt = simulator.decoder.moves.length;
    for (let i = 0; i < 50; i += 1) await tick();
    expect(store().sending?.sent).toBe(heldAt);
    expect(simulator.decoder.moves.length).toBe(ranAt);

    await store().resume();
    expect(store().phase).toBe('running');
    expect(simulator.paused).toBe(false);
    await until(() => (store().sending?.sent ?? 0) >= (heldAt ?? 0) + 3, 'three more packets');

    await store().abort();
    await started;
    expect(store().phase).toBe('idle');
    expect(store().message).toMatch(/acknowledged the reset/);
    expect(simulator.resets).toBe(1);
    expect(simulator.queued).toBe(0);
    expect(store().head).toBeNull();
    expect(store().framed).toBeNull();
    const sent = simulator.received.length;
    for (let i = 0; i < 20; i += 1) await tick();
    expect(simulator.received.length).toBe(sent);
  });

  it('jogs with rapid moves and tracks the head', async () => {
    const simulator = await connectedHomed();
    await store().jog(10, 5);
    simulator.drain();
    expect(store().head).toEqual({ x: 394, y: 197 });
    expect([simulator.decoder.x, simulator.decoder.y]).toEqual([394, 197]);
    expect(simulator.decoder.moves.every((move) => !move.laser)).toBe(true);
  });

  // ADR-703 Amendment 2 (C2 verification E2-P3-1): Ctrl+. and ABORT MOTION
  // reset the board during a Jog or a Home too, and the head is then unknown.
  it.each([
    ['a Jog', () => store().jog(10, 5)],
    ['a Home', () => store().home()],
  ])('Abort during %s resets the board', async (_label, move) => {
    const simulator = await connectedHomed();
    const moving = move();
    expect(activeLinkMachineWork()).not.toBeNull();
    await activeLinkMachineWork()?.abort();
    await moving;
    expect(simulator.resets).toBe(1);
    expect(store().phase).toBe('idle');
    expect(store().head).toBeNull();
  });

  // C2 verification E2-P2-1: the job's warnings show from its Frame on, as on
  // Moshi and Ruida, so the operator reads them before Start.
  it('shows the job warnings from the Frame on', async () => {
    const simulator = await connectedHomed();
    const job = zigzagJob(4);
    await store().frame(job);
    simulator.drain();
    expect(store().advisories).toEqual(job.advisories);
  });

  it('sends a packet again when the board rejects its checksum', async () => {
    const simulator = await connectedHomed();
    const job = zigzagJob(2);
    await store().frame(job);
    simulator.corruptNextPackets(2);
    await store().start(job);
    expect(store().phase).toBe('idle');
    expect(simulator.rejected).toBe(2);
    expect(store().message).toMatch(/finish/);
  });

  it('reports a pulled cable as a closed link', async () => {
    await connectedHomed();
    const job = zigzagJob(16);
    await store().frame(job);
    const started = store().start(job);
    await until(() => (store().sending?.sent ?? 0) >= 2, 'two packets');
    device?.unplug();
    await started;
    expect(store().phase).toBe('disconnected');
    expect(store().message).toMatch(/unplugged/);
    // The session is released, so Disconnect or another program can take it
    // (code quality audit C2 D4-P3-1).
    expect(device?.calls.some((call) => call.kind === 'close')).toBe(true);
    expect(activeLinkMachineWork()).toBeNull();
  });

  it('says a closed link once, without a doubled full stop', () => {
    expect(lihuiyuLinkLost('timed out.', false)).toBe(
      'The USB link to the board closed: timed out.',
    );
  });

  // Code quality audit C2 D4-P1-1: a K40 job was invisible to every guard.
  it('reports its job to the app-wide guards, and Ctrl+. resets the board', async () => {
    const simulator = await connectedHomed();
    const job = zigzagJob(16);
    await store().frame(job);
    const started = store().start(job);
    await until(() => (store().sending?.sent ?? 0) >= 3, 'three packets');
    expect(activeLinkMachineWork()).toMatchObject({
      controller: 'K40',
      activity: 'running',
      advisories: job.advisories,
    });
    expect(anyMachineJobActive()).toBe(true);
    const remove = installAbortShortcut(window);
    try {
      const key = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, cancelable: true });
      window.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      await started;
      await until(() => store().phase === 'idle', 'idle after the reset');
    } finally {
      remove();
    }
    expect(simulator.resets).toBe(1);
    expect(activeLinkMachineWork()).toBeNull();
  });

  it('opens the CH341 in EPP mode, reads its version, and frames every packet with 0xA6', async () => {
    const simulator = new LihuiyuSimulator();
    const fake = await connectTo(simulator);
    const [init, version] = fake.calls;
    expect(init).toMatchObject({ kind: 'control-out', setup: { request: 0xb1, value: 0x0102 } });
    expect(version).toMatchObject({ kind: 'control-in', setup: { request: 0x5f } });
    await store().home();
    const packetWrites = fake.writes().filter((bytes) => bytes.length > 1);
    expect(packetWrites).toHaveLength(1);
    expect(packetWrites[0]?.[0]).toBe(0xa6);
    expect(packetWrites[0]?.[32]).toBe(0xa6);
    expect(packetWrites[0]).toHaveLength(34);
  });

  it('points a Windows driver failure at the WinUSB help', async () => {
    const adapter: UsbLinkAdapter = {
      request: async () => {
        throw new UsbLinkOpenError('driver', 'The board could not be claimed.');
      },
      reopen: async () => null,
    };
    await store().connect(lihuiyuUsbOpener(adapter), tick);
    expect(store().phase).toBe('disconnected');
    expect(store().message).toContain(LIHUIYU_DRIVER_HELP);
  });
});
