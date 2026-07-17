import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { PAUSE_RESUME_TRANSITION_TIMEOUT_MS } from './laser-pause-resume-transition';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { useLaserStore } from './laser-store';

const GRBL_SAFETY_DOOR = '\x84';
const GRBL_SOFT_RESET = '\x18';
const STATUS_QUERY = '?';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

function makeConnection(
  writes: string[],
  writeOverride?: (data: string) => Promise<void>,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      await writeOverride?.(data);
      // Real GRBL answers the connect-time $G modal query (C6) with its state
      // then ok; model it so the modal query settles during connect.
      if (data === '$G\n') {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
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
    emitLine: (line) => emit(line),
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flushPromises();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushPromises();
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await flushPromises();
  // Let the detached handshake issue its post-qualification $G (C6) and the
  // fake connection auto-reply settle before the test drives more I/O.
  await flushPromises();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    safetyNotice: null,
    lastWriteError: null,
    log: [],
  });
});

describe('Pause and Resume transition liveness', () => {
  it('uses the active-stream heartbeat deadline while Pause owns liveness', () => {
    expect(PAUSE_RESUME_TRANSITION_TIMEOUT_MS).toBe(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS);
  });

  it('quarantines a pending Pause when the serial receive path closes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    await useLaserStore.getState().startJob(['G21', 'G90', 'M4 S0', 'G1 X1 S100', 'M5'].join('\n'));
    writes.length = 0;

    const pause = useLaserStore.getState().pauseJob();
    const rejected = expect(pause).rejects.toThrow(/controller operation was cancelled/i);
    await flushPromises();
    connection.emitClose();
    await rejected;

    expect(useLaserStore.getState().streamer?.status).toBe('disconnected');
    expect(writes).toContain(GRBL_SAFETY_DOOR);
    expect(writes).not.toContain(GRBL_SOFT_RESET);
  });

  it('does not accept a stale status received while the Pause write is pending', async () => {
    const pauseWrite = deferred();
    const writes: string[] = [];
    const connection = makeConnection(writes, (data) =>
      data === GRBL_SAFETY_DOOR ? pauseWrite.promise : Promise.resolve(),
    );
    await connectWith(connection);
    await useLaserStore.getState().startJob(['G21', 'G90', 'M4 S0', 'G1 X1 S100', 'M5'].join('\n'));
    writes.length = 0;

    let settled = false;
    const pause = useLaserStore
      .getState()
      .pauseJob()
      .then(() => {
        settled = true;
      });
    await flushPromises();
    connection.emitLine('<Door:0|MPos:4.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    pauseWrite.resolve();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toContain(STATUS_QUERY);
    expect(settled).toBe(false);
    connection.emitLine('<Door:0|MPos:4.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    await pause;
    expect(settled).toBe(true);
  });
});
