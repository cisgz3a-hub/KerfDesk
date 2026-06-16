import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await Promise.resolve();
}

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    log: [],
    transcript: [],
    safetyNotice: null,
  });
  vi.restoreAllMocks();
});

describe('laser-store machine compatibility', () => {
  it('starts jobs with profile-selected ping-pong streaming when requested', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore.getState().startJob('G21\nG90\nM5\n', {
      ...DEFAULT_DEVICE_PROFILE,
      controller: {
        ...DEFAULT_DEVICE_PROFILE.controller,
        streamingMode: 'ping-pong',
      },
    });

    expect(writes).toEqual(['G21\n']);
    expect(useLaserStore.getState().streamer?.streamingMode).toBe('ping-pong');
  });

  it('suppresses periodic status polls during jobs when the profile requests polling off', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore
      .getState()
      .startJob('G21\nG90\nM5\n', NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(writes).toEqual(['G21\n']);
  });
});
