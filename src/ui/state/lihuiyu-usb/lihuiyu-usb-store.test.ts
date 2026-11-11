// The Lihuiyu USB store against the simulated board behind its USB session
// (ADR-703): Home, Frame, Start, Pause, Resume and Abort, and the failures a
// link can meet. Simulator-tested only; nothing here touches hardware.

import { afterEach, describe, expect, it } from 'vitest';
import { joinCollinear } from '../../../__fixtures__/controllers/lihuiyu-decoder';
import { lihuiyuSimulatorConnection } from '../../../__fixtures__/controllers/lihuiyu-sim-connection';
import { LihuiyuSimulator } from '../../../__fixtures__/controllers/lihuiyu-simulator';
import { encodeLhyJob, lhyBoardSetting } from '../../../core/controllers/lihuiyu/lhy-encoder';
import { lhyFootprint } from '../../../core/controllers/lihuiyu/lhy-frame';
import type { CutGroup } from '../../../core/job';
import { LIHUIYU_FRAME_FIRST, LIHUIYU_HOME_FIRST } from './lihuiyu-usb-messages';
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

async function connectedHomed(simulator = new LihuiyuSimulator()): Promise<LihuiyuSimulator> {
  await store().connect(async () => lihuiyuSimulatorConnection(simulator), tick);
  expect(store().phase).toBe('idle');
  await store().home();
  expect(store().head).toEqual({ x: 0, y: 0 });
  return simulator;
}

afterEach(() => resetLihuiyuUsbStoreForTests());

describe('Lihuiyu USB store', () => {
  it('connects, reads status, and refuses Absolute work before Home and Start before Frame', async () => {
    const simulator = new LihuiyuSimulator();
    await store().connect(async () => lihuiyuSimulatorConnection(simulator), tick);
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
    const simulator = await connectedHomed();
    const job = zigzagJob(16);
    await store().frame(job);
    const started = store().start(job);
    await until(() => (store().sending?.sent ?? 0) >= 2, 'two packets');
    simulator.unplug();
    await started;
    expect(store().phase).toBe('disconnected');
    expect(store().message).toMatch(/unplugged/);
  });
});
