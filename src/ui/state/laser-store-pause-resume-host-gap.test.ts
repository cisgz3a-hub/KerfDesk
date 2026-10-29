// Rolling audit v6 K2-P1-2 (ADR-356 Amendment 2): the Pause/Resume silence
// deadline against a page stall. During a stall no timer or reader runs; when
// it ends, every timer that fell due runs at once and reads the same late
// clock. The controller's reply either reaches the store before those timers
// (worker order) or after them (desktop network order), and a Resume still
// has its refill write to settle on a later task. Neither the stall nor that
// order is the controller's silence: a laser must not be fail-dark reset
// while it reports Run, and a Run that arrived before the deadline completes
// the Resume.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import {
  captureTestLaserStartFenceAck,
  respondToTestGrblHandshake,
} from './laser-test-start-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';

const SAFETY_DOOR = '\x84';
const RESUME = '~';
const SOFT_RESET = '\x18';
const RUN_REPORT = '<Run|MPos:4.000,0.000,0.000|FS:1000,100|Ov:100,100,100>';
const PARKED_REPORT = '<Door:0|MPos:4.000,0.000,0.000|FS:0,0|Ov:100,100,100>';

type FakeController = SerialConnection & {
  readonly writes: string[];
  readonly emitLine: (line: string) => void;
  /** Hold status replies from now on, as a stalled reader or late link would. */
  readonly holdReplies: () => void;
  readonly releaseReplies: () => void;
  /** Writes from now on settle `ms` later, or only on settleWrites() when null. */
  readonly settleWritesAfter: (ms: number | null) => void;
  readonly settleWrites: () => void;
};

function fakeController(): FakeController {
  const writes: string[] = [];
  const lineHandlers = new Set<(line: string) => void>();
  const held: string[] = [];
  const unsettled: Array<() => void> = [];
  let report = RUN_REPORT;
  let holding = false;
  let settleAfter: number | null | undefined;
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  const settle = (): Promise<void> => {
    if (settleAfter === undefined) return Promise.resolve();
    if (settleAfter === null) return new Promise((resolve) => unsettled.push(resolve));
    const ms = settleAfter;
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
  return {
    writes,
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emitLine);
      writes.push(data);
      if (data === SAFETY_DOOR) report = PARKED_REPORT;
      if (data === RESUME) report = RUN_REPORT;
      if (data === '?') {
        if (holding) held.push(report);
        else setTimeout(() => emitLine(report), 0);
      }
      await settle();
      acknowledgeStartFence();
      respondToTestGrblHandshake(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
    holdReplies: () => {
      holding = true;
    },
    releaseReplies: () => {
      holding = false;
      for (const line of held.splice(0)) emitLine(line);
    },
    settleWritesAfter: (ms) => {
      settleAfter = ms;
    },
    settleWrites: () => {
      settleAfter = undefined;
      for (const resolve of unsettled.splice(0)) resolve();
    },
  };
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

function observe(promise: Promise<void>): () => 'pending' | 'resolved' | 'rejected' {
  let result: 'pending' | 'resolved' | 'rejected' = 'pending';
  promise.then(
    () => {
      result = 'resolved';
    },
    () => {
      result = 'rejected';
    },
  );
  return () => result;
}

/** One task blocks the page for `ms`. `first` is input already read when it
 * ends (worker order); everything else waits behind the timers that fell due. */
async function stallPage(ms: number, first?: () => void): Promise<void> {
  const end = Date.now() + ms;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(end);
  first?.();
  await vi.advanceTimersByTimeAsync(ms);
  clock.mockRestore();
  expect(Date.now()).toBe(end);
}

async function streamLaserJob(controller: FakeController): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(controller));
  controller.emitLine('Grbl 1.1f');
  await flush();
  controller.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  controller.emitLine('$32=1');
  controller.emitLine('ok');
  await flush();
  await flush();
  useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
  await startTestLaserJobOnClock(
    ['G21', 'G90', 'M4 S0', ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`), 'M5'].join(
      '\n',
    ),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

async function pauseAtDoor(controller: FakeController): Promise<void> {
  const pause = useLaserStore.getState().pauseJob();
  await vi.advanceTimersByTimeAsync(10);
  await pause;
  // Free the controller's buffer so Resume has lines to refill.
  for (const _line of useLaserStore.getState().streamer?.inFlight ?? []) controller.emitLine('ok');
  await flush();
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
  controller.writes.length = 0;
}

function expectRunningWithoutReset(controller: FakeController): void {
  expect(controller.writes).not.toContain(SOFT_RESET);
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  expect(useLaserStore.getState().safetyNotice).toBeNull();
  expect(controller.writes.some((data) => data.includes('G1 X'))).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  const disconnect = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(2_000);
  await disconnect;
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('laser Pause and Resume across a page stall', () => {
  it('completes Resume when the Run reply is read after a 2.1 s stall (network order)', async () => {
    const controller = fakeController();
    await streamLaserJob(controller);
    await pauseAtDoor(controller);

    controller.holdReplies();
    const resume = observe(useLaserStore.getState().resumeJob());
    await flush();
    expect(controller.writes).toContain(RESUME);
    await stallPage(2_100);
    controller.releaseReplies();
    await flush();
    await vi.advanceTimersByTimeAsync(50);

    expect(resume()).toBe('resolved');
    expectRunningWithoutReset(controller);
  });

  it('completes Resume when Run was read first but the refill settles after the stall', async () => {
    const controller = fakeController();
    await streamLaserJob(controller);
    await pauseAtDoor(controller);

    controller.holdReplies();
    const resume = observe(useLaserStore.getState().resumeJob());
    await flush();
    controller.settleWritesAfter(null);
    // Worker order: the reply is read before the overdue timers, but the
    // refill write it releases settles on the worker's later answer.
    await stallPage(2_100, () => controller.releaseReplies());
    controller.settleWrites();
    await flush();
    await vi.advanceTimersByTimeAsync(50);

    expect(resume()).toBe('resolved');
    expectRunningWithoutReset(controller);
  });

  // The refuter's case: the poll ran on schedule, the controller answered Run
  // 1 ms before the deadline, and each later write settles 4 ms later.
  it('completes Resume when Run arrives 1 ms before the deadline', async () => {
    const controller = fakeController();
    await streamLaserJob(controller);
    await pauseAtDoor(controller);

    controller.holdReplies();
    const resume = observe(useLaserStore.getState().resumeJob());
    await flush();
    await vi.advanceTimersByTimeAsync(1_999);
    controller.settleWritesAfter(4);
    controller.releaseReplies();
    await flush();
    await vi.advanceTimersByTimeAsync(50);

    expect(resume()).toBe('resolved');
    expectRunningWithoutReset(controller);
  });

  it('completes Pause when the parked report is read after a 2.1 s stall', async () => {
    const controller = fakeController();
    await streamLaserJob(controller);
    controller.writes.length = 0;

    controller.holdReplies();
    const pause = observe(useLaserStore.getState().pauseJob());
    await flush();
    expect(controller.writes).toContain(SAFETY_DOOR);
    await stallPage(2_100);
    controller.releaseReplies();
    await flush();
    await vi.advanceTimersByTimeAsync(50);

    expect(pause()).toBe('resolved');
    expect(controller.writes).not.toContain(SOFT_RESET);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('still fail-dark resets a Resume the controller never confirms after the stall', async () => {
    const controller = fakeController();
    await streamLaserJob(controller);
    await pauseAtDoor(controller);

    controller.holdReplies();
    const resume = observe(useLaserStore.getState().resumeJob());
    await flush();
    await stallPage(2_100);
    expect(resume()).toBe('pending');
    // Two seconds of on-schedule polling with no answer.
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(resume()).toBe('rejected');
    expect(controller.writes).toContain(SOFT_RESET);
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('stream-stalled');
  });
});
