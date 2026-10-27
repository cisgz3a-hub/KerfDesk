// ADR-398 Amendment 5 (rolling audit v4 H2-P2-1, H2-P2-2 a): every reset
// KerfDesk sends against a running job discards the controller's planner, so
// its record steps back over the same moves Abort's does. Before, the reset
// that contains a lost heartbeat, and the Abort the app sends as it closes,
// were recorded without the backlog and restarted after moves that never ran.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { automaticRestart } from '../../core/recovery/automatic-restart-line';
import { observedStreamInterruption } from '../app/job-checkpoint-repository';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { captureTestLaserStartFenceAck } from './laser-test-start-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

let liveConnection: FakeConnection | null = null;

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const connection: FakeConnection = {
    write: async (data) => {
      const ackFence = captureTestLaserStartFenceAck(data, (line) => connection.emitLine(line));
      writes.push(data);
      ackFence();
      if (data === '\x18') setTimeout(() => connection.emitLine('Grbl 1.1f'), 0);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        connection.emitLine('[VER:1.1h.20190830:test]');
        connection.emitLine('[OPT:VM,15,128]');
        connection.emitLine('ok');
      }
      if (data === '$G\n') {
        connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        connection.emitLine('ok');
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
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
  return connection;
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
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|Bf:15,128|FS:0,0>');
  await flush();
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await flush();
  await flush();
}

const GCODE = [
  'G21',
  'G90',
  'M4 S0',
  ...Array.from({ length: 60 }, (_, i) => `G1 X${i + 1} S100 F600`),
  'M5',
].join('\n');

/** 40 lines acknowledged, then a report of 10 planner blocks still queued. */
async function runToBacklog(connection: FakeConnection): Promise<number> {
  await startTestLaserJobOnClock(GCODE);
  await vi.advanceTimersByTimeAsync(5);
  for (let i = 0; i < 200; i += 1) {
    const streamer = useLaserStore.getState().streamer;
    if (streamer === null || streamer.completed >= 40 || streamer.inFlight.length === 0) break;
    connection.emitLine('ok');
    await flush();
  }
  connection.emitLine('<Run|MPos:30.000,0.000,0.000|Bf:5,100|FS:600,100>');
  await flush();
  return useLaserStore.getState().streamer?.completed ?? -1;
}

async function restartAfter(stop: (connection: FakeConnection) => Promise<void>) {
  const writes: string[] = [];
  const connection = makeConnection(writes);
  liveConnection = connection;
  await connectReady(connection);
  const acked = await runToBacklog(connection);
  writes.length = 0;
  await stop(connection);
  await flush();
  const state = useLaserStore.getState();
  const interruption = observedStreamInterruption(state.streamer?.status ?? 'disconnected', state);
  return {
    acked,
    resetWritten: writes.includes('\x18'),
    interruption,
    restart: automaticRestart(GCODE, acked, interruption ?? undefined),
  };
}

async function abort(): Promise<void> {
  void useLaserStore.getState().stopJob();
  await vi.advanceTimersByTimeAsync(50);
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  liveConnection?.emitClose();
  liveConnection = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Abort's restart from the same state: ten queued moves stepped back over.
const BACKLOG = { ackedAtStatus: 40, queuedBlocks: 10 };
const ABORT_LINE = automaticRestart(GCODE, 40, {
  kind: 'cancelled',
  message: 'Stopped by the operator (Abort).',
  plannerBacklog: BACKLOG,
}).line;

describe('a reset KerfDesk sends against a running job records the planner backlog', () => {
  it('steps back over the queued moves after Abort', async () => {
    const aborted = await restartAfter(abort);
    expect(aborted.acked).toBe(40);
    expect(aborted.resetWritten).toBe(true);
    expect(aborted.interruption?.plannerBacklog).toEqual(BACKLOG);
    expect(aborted.restart.line).toBe(ABORT_LINE);
    expect(ABORT_LINE).toBeLessThan(aborted.acked + 1);
  });

  it('steps back as far after the reset that contains a lost heartbeat (H2-P2-1)', async () => {
    const stalled = await restartAfter(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    });
    expect(stalled.acked).toBe(40);
    expect(stalled.resetWritten).toBe(true);
    expect(stalled.interruption?.kind).toBe('stream-stalled');
    expect(stalled.interruption?.plannerBacklog).toEqual(BACKLOG);
    expect(stalled.restart.line).toBe(ABORT_LINE);
    expect(stalled.restart.plannerBacklogBasis).toBe('status-backlog');
  });

  it('steps back as far after the Abort the app sends as it closes (H2-P2-2)', async () => {
    const closing = await restartAfter(async () => {
      void useLaserStore.getState().stopJob('app-closing');
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(closing.resetWritten).toBe(true);
    expect(closing.interruption?.kind).toBe('cancelled');
    expect(closing.interruption?.message).toContain('closed or reloaded');
    expect(closing.interruption?.plannerBacklog).toEqual(BACKLOG);
    expect(closing.restart.line).toBe(ABORT_LINE);
  });
});
