import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type MotionOperationSnapshot = {
  readonly kind: 'frame' | 'jog';
  readonly sawControllerBusy: boolean;
  readonly idleStatusReports?: number;
  readonly dispatchComplete?: boolean;
} | null;

function getMotionOperation(): MotionOperationSnapshot {
  return (
    (useLaserStore.getState() as { readonly motionOperation?: MotionOperationSnapshot })
      .motionOperation ?? null
  );
}

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
  await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store active-job command guard', () => {
  it.each([
    ['Home', () => useLaserStore.getState().home(), '$H'],
    ['Unlock', () => useLaserStore.getState().unlockAlarm(), '$X'],
    ['Jog', () => useLaserStore.getState().jog({ dx: 1, feed: 1000 }), '$J='],
    [
      'Frame',
      () => useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000),
      '$J=',
    ],
  ] as const)(
    'blocks %s while a job is active so GRBL never sees an idle-only $ command',
    async (_label, runCommand, forbiddenPrefix) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection);
      await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
      writes.length = 0;

      await expect(runCommand()).rejects.toThrow(/job is active/i);

      expect(writes.some((line) => line.startsWith(forbiddenPrefix))).toBe(false);
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');
      expect(useLaserStore.getState().log.join('\n')).toContain('Serial write blocked');
      expect(getMotionOperation()).toBeNull();
    },
  );

  it('blocks autofocus while a job is active before writing the configured command', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().autofocus('$HZ1')).resolves.toMatchObject({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/job is active/i),
    });

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });

  it('blocks Set/Reset Origin while a job is active', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().setOriginHere()).rejects.toThrow(/job is active/i);
    await expect(useLaserStore.getState().resetOrigin()).rejects.toThrow(/job is active/i);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });
});
