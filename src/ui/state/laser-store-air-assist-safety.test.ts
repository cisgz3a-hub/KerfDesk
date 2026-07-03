import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(
  write: (data: string) => Promise<void>,
  close: () => Promise<void> = async () => undefined,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close,
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

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    streamer: null,
    log: [],
  });
  vi.restoreAllMocks();
});

describe('laser store air assist safety cleanup', () => {
  it('sends coolant off during normal Stop cleanup when serial is alive', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nM8\nG1 X1 F600 S100\nM9\nM5\n');

    writes.length = 0;
    await useLaserStore.getState().stopJob();

    expect(writes.join('')).toContain(RT_SOFT_RESET);
    expect(writes.join('')).toContain('M9\n');
  });

  it('sends soft reset before coolant off when disconnecting an active job', async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write, close);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    write.mockClear();
    await useLaserStore.getState().disconnect();

    expect(write).toHaveBeenCalledWith(RT_SOFT_RESET);
    expect(write).toHaveBeenCalledWith('M9\n');
    expect(write.mock.calls.findIndex(([line]) => line === RT_SOFT_RESET)).toBeLessThan(
      write.mock.calls.findIndex(([line]) => line === 'M9\n'),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('sends soft reset before coolant off when disconnecting a job stopped by error', async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write, close);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    connection.emitLine('error:7');
    expect(useLaserStore.getState().streamer?.status).toBe('errored');

    write.mockClear();
    await useLaserStore.getState().disconnect();

    expect(write).toHaveBeenCalledWith(RT_SOFT_RESET);
    expect(write).toHaveBeenCalledWith('M9\n');
    expect(write.mock.calls.findIndex(([line]) => line === RT_SOFT_RESET)).toBeLessThan(
      write.mock.calls.findIndex(([line]) => line === 'M9\n'),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().streamer).toBeNull();
  });
});
