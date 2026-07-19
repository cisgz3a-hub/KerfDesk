import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

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
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: emit,
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

async function connectWith(connection: FakeConnection, freshIdle = true): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  if (freshIdle) connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  if (freshIdle) connection.emitLine('ok');
  await flushConnect();
}

async function flushConnect(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
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
    ['Jog', () => useLaserStore.getState().jog({ dx: 1, feed: 1000 })],
    ['Frame', () => useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000)],
  ] as const)(
    'blocks %s before the first Idle status so GRBL never sees a premature $J command',
    async (_label, runCommand) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection, false);
      expect(useLaserStore.getState().statusReport).toBeNull();
      writes.length = 0;

      await expect(runCommand()).rejects.toThrow(/controller operation is active/i);

      expect(writes.some((line) => line.startsWith('$J='))).toBe(false);
      expect(useLaserStore.getState().lastWriteError).toMatch(/controller operation is active/i);
      expect(getMotionOperation()).toBeNull();
    },
  );

  it.each([
    ['Jog', () => useLaserStore.getState().jog({ dx: 1, feed: 1000 })],
    ['Frame', () => useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000)],
  ] as const)(
    'blocks %s while a prior jog/frame operation is still active even if the last status was Idle',
    async (_label, runCommand) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection);
      connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      useLaserStore.setState({
        motionOperation: {
          operationId: 1,
          kind: 'jog',
          sawControllerBusy: false,
          idleStatusReports: 0,
          dispatchComplete: true,
          pendingLines: [],
        },
      } as Partial<ReturnType<typeof useLaserStore.getState>>);
      writes.length = 0;

      await expect(runCommand()).rejects.toThrow(/operation is active/i);

      expect(writes.some((line) => line.startsWith('$J='))).toBe(false);
      expect(useLaserStore.getState().lastWriteError).toMatch(/operation is active/i);
      expect(getMotionOperation()).toMatchObject({ kind: 'jog' });
    },
  );

  it.each([
    ['Home', () => useLaserStore.getState().home()],
    ['Unlock', () => useLaserStore.getState().unlockAlarm()],
    ['Set Origin', () => useLaserStore.getState().setOriginHere()],
    ['Reset Origin', () => useLaserStore.getState().resetOrigin()],
    ['Set Persistent Origin', () => useLaserStore.getState().setPersistentOriginHere()],
    ['Clear Persistent Origin', () => useLaserStore.getState().clearPersistentOrigin()],
    ['Start job', () => startTestLaserJob('G21\nG90\nG1 X1 F1000\nM5\n')],
  ] as const)('blocks %s while a jog/frame operation is active', async (_label, runCommand) => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    useLaserStore.setState({
      workOriginActive: true,
      wcoCache: { x: 1, y: 1, z: 0 },
      motionOperation: {
        operationId: 2,
        kind: 'jog',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    writes.length = 0;

    await expect(runCommand()).rejects.toThrow(/operation is active/i);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().lastWriteError).toMatch(/operation is active/i);
    expect(getMotionOperation()).toMatchObject({ kind: 'jog' });
  });

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
      await startTestLaserJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
      writes.length = 0;

      await expect(runCommand()).rejects.toThrow(/job is active/i);

      expect(writes.some((line) => line.startsWith(forbiddenPrefix))).toBe(false);
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');
      expect(useLaserStore.getState().log.join('\n')).toMatch(
        /(Serial write blocked|Motion command blocked|Home command blocked)/,
      );
      expect(getMotionOperation()).toBeNull();
    },
  );

  it('blocks autofocus while a job is active before writing the configured command', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await startTestLaserJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
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
    await startTestLaserJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().setOriginHere()).rejects.toThrow(/job is active/i);
    await expect(useLaserStore.getState().resetOrigin()).rejects.toThrow(/job is active/i);
    await expect(useLaserStore.getState().setPersistentOriginHere()).rejects.toThrow(
      /job is active/i,
    );
    await expect(useLaserStore.getState().clearPersistentOrigin()).rejects.toThrow(
      /job is active/i,
    );

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });

  it('keeps idle-only $ commands blocked after all lines are acked until GRBL reports Idle', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await startTestLaserJob('G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5\n');
    for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
    expect(useLaserStore.getState().streamer?.status).toBe('done');
    writes.length = 0;

    await expect(useLaserStore.getState().home()).rejects.toThrow(
      /previous controller write and terminal acknowledgement settle/i,
    );

    expect(writes.some((line) => line.startsWith('$H'))).toBe(false);
    expect(useLaserStore.getState().streamer?.status).toBe('done');
  });
});
