import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
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
      requestPort: async () => ({
        open: async () => connection,
      }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushConnect();
}

async function flushConnect(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('laser-store profile streaming options', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await useLaserStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  it('uses the configured RX buffer limit before starting the stream', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await expect(
      useLaserStore.getState().startJob('G21\nG1 X1234567890\n', { rxBufferBytes: 10 }),
    ).rejects.toThrow(/10-byte RX buffer/i);

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(writes).toEqual([]);
  });

  it('honors ping-pong streaming mode for the initial send window', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore
      .getState()
      .startJob('G21\nG90\nM3 S0\nM5\n', { streamingMode: 'ping-pong' });

    expect(writes[0]).toBe('G21\n');
    expect(useLaserStore.getState().streamer).toMatchObject({
      streamingMode: 'ping-pong',
      rxBufferBytes: 120,
      inFlight: [{ line: 'G21\n', bytes: 4 }],
      completed: 0,
    });
  });
});
