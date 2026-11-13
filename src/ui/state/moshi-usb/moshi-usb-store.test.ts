// The Moshi USB store (ADR-705) driving the scripted Moshiboard: Frame-first
// Start, a laser-off Frame, Start sending exactly the encoded programs, Abort
// mid-run with the estop, and the factual refusals. Simulator only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MoshiSimulator,
  type MoshiSimulatorScript,
} from '../../../__fixtures__/controllers/moshi-simulator';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { encodeMoshiJob } from '../../../core/controllers/moshi';
import type { Job } from '../../../core/job';
import { MOSHI_FRAME_FIRST } from './moshi-usb-messages';
import { resetMoshiUsbStoreForTests, useMoshiUsbStore } from './moshi-usb-store';
import type { MoshiUsbConnection, MoshiUsbJob } from './moshi-usb-types';
import { testLinkJobOutcome } from '../link-job-outcome-test-helpers';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#f00',
      power: 60,
      speed: 1200,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 50, y: 10 },
            { x: 50, y: 30 },
            { x: 10, y: 30 },
            { x: 10, y: 10 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

function compiled(job: Job = JOB): MoshiUsbJob {
  const result = encodeMoshiJob(job, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' });
  if (!result.ok) throw new Error(result.error.kind);
  return {
    programs: result.programs.map((program) => program.bytes),
    footprint: result.footprint,
    ...testLinkJobOutcome(['Layer L1: a warning']),
    framingFeedMmPerMin: 3000,
  };
}

function connection(board: MoshiSimulator): MoshiUsbConnection & { drop: () => void } {
  const handlers = new Set<() => void>();
  return {
    writeData: board.writeData,
    writeAddress: board.writeAddress,
    readStatus: board.readStatus,
    label: 'simulated CH341',
    onDisconnect: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: async () => undefined,
    drop: () => handlers.forEach((handler) => handler()),
  };
}

async function connected(script: MoshiSimulatorScript = {}) {
  const board = new MoshiSimulator(script);
  const link = connection(board);
  await useMoshiUsbStore.getState().connect(async () => link, { wait: async () => undefined });
  return { board, link, store: useMoshiUsbStore };
}

afterEach(() => resetMoshiUsbStoreForTests());

describe('Moshi USB store', () => {
  it('connects and reads the board status', async () => {
    const { store } = await connected();
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().status).toBe(205);
  });

  it('releases the device when the first status read fails (C2 D1-P3-1)', async () => {
    let closes = 0;
    const link = {
      ...connection(new MoshiSimulator()),
      readStatus: async (): Promise<Uint8Array> => {
        throw new Error('transfer stalled');
      },
      close: async () => {
        closes += 1;
      },
    };
    await useMoshiUsbStore.getState().connect(async () => link, { wait: async () => undefined });
    expect(useMoshiUsbStore.getState().phase).toBe('disconnected');
    expect(useMoshiUsbStore.getState().message).toBe('transfer stalled');
    expect(closes).toBe(1);
  });

  it('refuses Start until a Frame of the same footprint completes', async () => {
    const { board, store } = await connected();
    await store.getState().start(compiled());
    expect(store.getState().message).toBe(MOSHI_FRAME_FIRST);
    expect(board.events.some((event) => event.kind === 'prologue')).toBe(false);

    await store.getState().frame(compiled());
    expect(store.getState().framed).toEqual(compiled().footprint);
    expect(board.runs[0]?.program.steps.every((step) => !step.cut)).toBe(true);
    expect(board.runs[0]?.program.speed).toBe(50);

    const moved = compiled({
      groups: JOB.groups.map((group) =>
        group.kind === 'cut'
          ? {
              ...group,
              segments: [
                {
                  polyline: [
                    { x: 20, y: 10 },
                    { x: 60, y: 10 },
                  ],
                  closed: false,
                },
              ],
            }
          : group,
      ),
    });
    await store.getState().start(moved);
    expect(store.getState().message).toBe(MOSHI_FRAME_FIRST);
    expect(board.runs).toHaveLength(1);
  });

  it('Start sends exactly the encoded programs after a Frame', async () => {
    const { board, store } = await connected();
    const job = compiled();
    await store.getState().frame(job);
    await store.getState().start(job);
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().message).toContain('Job finished');
    expect(board.runs).toHaveLength(2);
    const burn = board.runs[1]?.program;
    // 10..50 mm x 10..30 mm in mils, laser on round the rectangle.
    expect(burn?.steps).toEqual([
      { x: 394, y: 394, cut: false },
      { x: 1969, y: 394, cut: true },
      { x: 1969, y: 1181, cut: true },
      { x: 394, y: 1181, cut: true },
      { x: 394, y: 394, cut: true },
    ]);
  });

  it('Abort sends the estop, stops sending and voids the Frame', async () => {
    let store: typeof useMoshiUsbStore | null = null;
    let aborting: Promise<void> | null = null;
    const ctx = await connected({
      onData: () => {
        if (store?.getState().phase === 'running' && aborting === null)
          aborting = store.getState().abort();
      },
    });
    store = ctx.store;
    const long = compiled({
      groups: JOB.groups.map((group) => (group.kind === 'cut' ? { ...group, passes: 20 } : group)),
    });
    await ctx.store.getState().frame(long);
    const dataBeforeStart = ctx.board.events.filter((event) => event.kind === 'data').length;
    await ctx.store.getState().start(long);
    await aborting;
    const events = ctx.board.events.slice();
    const estopAt = events.findIndex((event) => event.kind === 'estop');
    expect(estopAt).toBeGreaterThan(0);
    expect(events.slice(estopAt).some((event) => event.kind === 'data')).toBe(false);
    expect(events.filter((event) => event.kind === 'data').length - dataBeforeStart).toBe(1);
    expect(ctx.store.getState().phase).toBe('idle');
    expect(ctx.store.getState().framed).toBeNull();
    expect(ctx.board.cuts()).toEqual([]);
  });

  it('sends nothing to a board that reports an error', async () => {
    const { board, store } = await connected();
    board.failNextStatus();
    await store.getState().frame(compiled());
    expect(store.getState().tone).toBe('error');
    expect(store.getState().framed).toBeNull();
    expect(board.events.some((event) => event.kind === 'prologue')).toBe(false);
  });

  it('a lost link during a run says the board may still be running', async () => {
    let drop: (() => void) | null = null;
    const ctx = await connected({ onData: () => drop?.() });
    drop = ctx.link.drop;
    await ctx.store.getState().frame(compiled());
    expect(ctx.store.getState().phase).toBe('disconnected');
    expect(ctx.store.getState().message).toContain('may still be running');
  });

  it('runs the job completion (variable advance) once the job finishes, not after a Frame', async () => {
    const { store } = await connected();
    const completed = vi.fn();
    const job = { ...compiled(), completed };
    await store.getState().frame(job);
    expect(completed).not.toHaveBeenCalled();
    await store.getState().start(job);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('Home runs MeerK40t’s move to 0,0', async () => {
    const { board, store } = await connected();
    await store.getState().home();
    expect(board.runs[0]?.program.steps).toEqual([{ x: 0, y: 0, cut: false }]);
    expect(store.getState().phase).toBe('idle');
  });
});
