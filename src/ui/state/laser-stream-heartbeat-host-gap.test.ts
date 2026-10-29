// Rolling audit v6 K2-P1-1 and K2-P3-2 (ADR-356 Amendment 2): the real store,
// poll, heartbeat and containment against a fake GRBL that never acknowledges
// the job's moves, so only status reports prove the link. One or more replies
// are late, then the page stalls for under two seconds and the replies arrive
// during it. On a worker the browser reads them before the overdue poll tick
// (data first); on the desktop network transport the reply's body is read on
// a task queued behind that tick (timer first). Neither order may reset a
// healthy job, and a controller that stays silent must still be reset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { captureTestLaserStartFenceAck } from './laser-test-start-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';

const RUN_REPORT = '<Run|MPos:1.000,0.000,0.000|FS:1000,100>';

type FakeController = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  /** Hold every status reply from now on, as a late link would. */
  readonly holdReplies: () => void;
  /** Deliver the held replies and answer on time again. */
  readonly releaseReplies: () => void;
  readonly closes: () => number;
};

let live: FakeController | null = null;

function fakeController(writes: string[], readThrough?: () => number): FakeController {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const held: string[] = [];
  let holding = false;
  let closes = 0;
  const controller: FakeController = {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, (line) =>
        controller.emitLine(line),
      );
      writes.push(data);
      acknowledgeStartFence();
      if (data === '?') {
        if (holding) held.push(RUN_REPORT);
        else void Promise.resolve().then(() => controller.emitLine(RUN_REPORT));
      }
      if (data === '\x18') setTimeout(() => controller.emitLine('Grbl 1.1f'), 0);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        controller.emitLine('[VER:1.1h.20190830:test]');
        controller.emitLine('[OPT:VM,15,128]');
        controller.emitLine('ok');
      }
      if (data === '$G\n') {
        controller.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        controller.emitLine('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => {
      closes += 1;
    },
    ...(readThrough === undefined ? {} : { inputReadThrough: readThrough }),
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    holdReplies: () => {
      holding = true;
    },
    releaseReplies: () => {
      holding = false;
      for (const line of held.splice(0)) controller.emitLine(line);
    },
    closes: () => closes,
  };
  return controller;
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
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function startStreaming(controller: FakeController): Promise<void> {
  live = controller;
  await useLaserStore.getState().connect(adapterFor(controller));
  controller.emitLine('Grbl 1.1f');
  await flush();
  controller.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  controller.emitLine('$32=1');
  controller.emitLine('ok');
  await flush();
  await flush();
  await startTestLaserJobOnClock(
    ['M4 S0', ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`), 'M5'].join('\n'),
  );
  // Settle into on-schedule polling with every reply on time.
  await vi.advanceTimersByTimeAsync(1_000);
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

/** `lateTicks` poll ticks see no new reply, then one task blocks the page for
 * `stallMs`: no timer or reader runs until it ends. */
async function lateRepliesThenStall(
  controller: FakeController,
  lateTicks: number,
  stallMs: number,
  order: 'timer-first' | 'data-first',
): Promise<void> {
  controller.holdReplies();
  // The first tick still sees the reply to the query before it.
  await vi.advanceTimersByTimeAsync(250 * (lateTicks + 1));
  vi.setSystemTime(Date.now() + stallMs - 250);
  if (order === 'data-first') controller.releaseReplies();
  // The overdue poll tick.
  await vi.advanceTimersByTimeAsync(250);
  if (order === 'timer-first') controller.releaseReplies();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  live?.emitClose();
  live = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('active-stream heartbeat across a sub-2 s page stall', () => {
  // Before ADR-356 Amendment 2 every timer-first row reset the job: the window
  // is 2,000 - 250u <= stall < 2,000 ms (audit K2-P1-1).
  it.each([
    [1, 1_750, 'timer-first'],
    [1, 1_900, 'timer-first'],
    [1, 1_999, 'timer-first'],
    [2, 1_500, 'timer-first'],
    [3, 1_250, 'timer-first'],
    [1, 1_900, 'data-first'],
    [3, 1_250, 'data-first'],
  ] as const)(
    'keeps a healthy job after %i late tick(s) and a %i ms stall read %s',
    async (lateTicks, stallMs, order) => {
      const writes: string[] = [];
      const controller = fakeController(writes);
      await startStreaming(controller);
      writes.length = 0;

      await lateRepliesThenStall(controller, lateTicks, stallMs, order);
      await vi.advanceTimersByTimeAsync(3_000);
      await flush();

      expect(writes).not.toContain('\x18');
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');
      expect(useLaserStore.getState().safetyNotice).toBeNull();
      expect(useLaserStore.getState().connection.kind).toBe('connected');
      expect(controller.closes()).toBe(0);
    },
  );

  it('still resets a controller that stays silent after the stall', async () => {
    const writes: string[] = [];
    const controller = fakeController(writes);
    await startStreaming(controller);
    writes.length = 0;

    controller.holdReplies();
    await vi.advanceTimersByTimeAsync(500);
    vi.setSystemTime(Date.now() + 1_900 - 250);
    await vi.advanceTimersByTimeAsync(250);
    // The late tick cannot judge its own gap.
    expect(writes).not.toContain('\x18');
    // The next tick on schedule can: nothing came back for over two seconds.
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(writes).toContain('\x18');
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toContain('M5\n');
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('stream-stalled');
  });

  // The desktop network transport reads in requests the main process holds
  // for up to a second. Silence after its last completed read is not yet the
  // controller's: an empty read that started before a reply arrived needs a
  // second read to bring it.
  it('waits for the transport to read before judging, then resets a silent controller', async () => {
    const writes: string[] = [];
    let readThrough = 0;
    const controller = fakeController(writes, () => readThrough);
    await startStreaming(controller);
    readThrough = Date.now();
    writes.length = 0;

    controller.holdReplies();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(writes).not.toContain('\x18');

    // A read issued now comes back empty.
    readThrough = Date.now();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(writes).toContain('\x18');
  });
});
