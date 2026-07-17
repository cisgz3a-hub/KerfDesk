import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, onAck, step } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { RESET_CLEANUP_BANNER_TIMEOUT_MS } from './laser-reset-cleanup';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly closeCount: () => number;
};

let liveConnection: FakeConnection | null = null;

function makeConnection(
  writes: string[],
  options: { readonly autoResetBanner?: boolean } = {},
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closes = 0;
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === '\x18' && options.autoResetBanner !== false) {
        setTimeout(() => connection.emitLine('Grbl 1.1f'), 0);
      }
      // Real GRBL answers the connect-time $G modal query (C6) with its state
      // then ok; model it so the modal query settles during connect.
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
    close: async () => {
      closes += 1;
    },
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    closeCount: () => closes,
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

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await flush();
  // Let the detached handshake issue its post-qualification $G (C6) and the
  // fake connection auto-reply settle before the test drives more I/O.
  await flush();
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  liveConnection?.emitClose();
  liveConnection = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('active stream transport heartbeat', () => {
  it('freezes the job and requests fail-dark reset when fresh status stops', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    liveConnection = connection;
    await connectReady(connection);
    await useLaserStore
      .getState()
      .startJob(
        [
          'G21',
          'G90',
          'M4 S0',
          ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`),
          'M5',
        ].join('\n'),
      );
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    await flush();

    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('stream-stalled');
    expect(writes).toContain('\x18');
    expect(writes).toContain('M5\n');
    expect(writes).toContain('M9\n');
    expect(writes.some((data) => data.includes('G1 X'))).toBe(false);
  });

  it('covers the acknowledged-but-physically-finishing window', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    liveConnection = connection;
    await connectReady(connection);
    const sent = step(createStreamer('G1 X1 S100')).state;
    const done = onAck(sent, 'ok').state;
    expect(done.status).toBe('done');
    useLaserStore.setState({ streamer: done, activeJobMachineKind: 'laser' });
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    await flush();

    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(writes).toContain('\x18');
  });

  it('shares one reset transaction with an operator Disconnect during heartbeat containment', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, { autoResetBanner: false });
    liveConnection = connection;
    await connectReady(connection);
    await useLaserStore
      .getState()
      .startJob(
        ['M4 S0', ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`), 'M5'].join('\n'),
      );
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 250);
    await flush();
    expect(writes.filter((data) => data === '\x18')).toHaveLength(1);

    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    connection.emitLine('Grbl 1.1f');
    await disconnect;
    await flush();

    expect(writes.filter((data) => data === '\x18')).toHaveLength(1);
    expect(writes.filter((data) => data === 'M5\n')).toHaveLength(1);
    expect(writes.filter((data) => data === 'M9\n')).toHaveLength(1);
    expect(connection.closeCount()).toBe(1);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('shares one reset transaction with connection replacement during heartbeat containment', async () => {
    const oldWrites: string[] = [];
    const oldConnection = makeConnection(oldWrites, { autoResetBanner: false });
    liveConnection = oldConnection;
    await connectReady(oldConnection);
    await useLaserStore
      .getState()
      .startJob(
        ['M4 S0', ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`), 'M5'].join('\n'),
      );
    oldWrites.length = 0;

    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 250);
    await flush();
    const newConnection = makeConnection([]);
    const reconnect = useLaserStore.getState().connect(adapterFor(newConnection));
    await flush();
    oldConnection.emitLine('Grbl 1.1f');
    await reconnect;
    liveConnection = newConnection;

    expect(oldWrites.filter((data) => data === '\x18')).toHaveLength(1);
    expect(oldWrites.filter((data) => data === 'M5\n')).toHaveLength(1);
    expect(oldWrites.filter((data) => data === 'M9\n')).toHaveLength(1);
    expect(oldConnection.closeCount()).toBe(1);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
  });

  it('closes the quarantined port before a banner arriving after the fallback can orphan cleanup acks', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, { autoResetBanner: false });
    liveConnection = connection;
    await connectReady(connection);
    await useLaserStore
      .getState()
      .startJob(
        ['M4 S0', ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`), 'M5'].join('\n'),
      );
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 250);
    await vi.advanceTimersByTimeAsync(RESET_CLEANUP_BANNER_TIMEOUT_MS);
    await flush();

    expect(writes).toContain('\x18');
    expect(writes).toContain('M5\n');
    expect(writes).toContain('M9\n');
    expect(connection.closeCount()).toBe(1);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
    });
    const sessionEpoch = useLaserStore.getState().controllerSessionEpoch;

    connection.emitLine('Grbl 1.1f');
    connection.emitLine('ok');
    connection.emitLine('ok');
    await flush();

    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      controllerSessionEpoch: sessionEpoch,
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
    });
  });
});
