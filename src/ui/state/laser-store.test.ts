import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  return {
    write,
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
  await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store serial write failures', () => {
  it('does not enter streaming state when the initial job write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('port lost');
    });
    const connection = makeConnection(write);
    await connectWith(connection);

    await expect(useLaserStore.getState().startJob('G21\nG90\nM3 S0\nM5\n')).rejects.toThrow(
      'port lost',
    );

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().log.join('\n')).toContain('Serial write failed: port lost');
  });

  it('keeps a streaming job streaming when feed-hold fails to send', async () => {
    let shouldFail = false;
    const write = vi.fn(async () => {
      if (shouldFail) throw new Error('write rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    shouldFail = true;
    await expect(useLaserStore.getState().pauseJob()).rejects.toThrow('write rejected');

    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'Serial write failed: write rejected',
    );
  });

  it('keeps a streaming job active when soft-reset fails to send', async () => {
    let shouldFail = false;
    const write = vi.fn(async () => {
      if (shouldFail) throw new Error('reset rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    shouldFail = true;
    await expect(useLaserStore.getState().stopJob()).rejects.toThrow('reset rejected');

    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'Serial write failed: reset rejected',
    );
  });

  it('rejects Set Origin when the G92 write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('origin rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);

    await expect(useLaserStore.getState().setOriginHere()).rejects.toThrow('origin rejected');
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'Serial write failed: origin rejected',
    );
  });

  it('marks the work origin active immediately after Set Origin succeeds', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');

    await useLaserStore.getState().setOriginHere();

    expect(write).toHaveBeenCalledWith('G92 X0 Y0\n');
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
  });

  it('clears the active work-origin flag when Reset Origin succeeds', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    useLaserStore.setState({ workOriginActive: true, wcoCache: { x: 12, y: 34, z: 0 } });

    await useLaserStore.getState().resetOrigin();

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().wcoCache).toBeNull();
  });
});
