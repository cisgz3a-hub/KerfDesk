import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
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

function setMotionOperation(operation: MotionOperationSnapshot): void {
  const normalized =
    operation === null ? null : { dispatchComplete: false, idleStatusReports: 0, ...operation };
  useLaserStore.setState({ motionOperation: normalized } as Partial<
    ReturnType<typeof useLaserStore.getState>
  >);
}

function makeConnection(
  write: (data: string) => Promise<void>,
  close: () => Promise<void> = async () => undefined,
): FakeConnection {
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
    lastWriteError: null,
    safetyNotice: null,
    streamer: null,
    motionOperation: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('laser-store motion operation disconnect safety', () => {
  it('sends jog cancel before disconnecting an active Frame operation', async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write, close);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: true, dispatchComplete: true });

    write.mockClear();
    await useLaserStore.getState().disconnect();

    expect(write).toHaveBeenCalledWith(RT_JOG_CANCEL);
    expect(close).toHaveBeenCalledTimes(1);
    expect(getMotionOperation()).toBeNull();
  });

  it('raises a disconnect safety notice if Frame jog-cancel fails before disconnect', async () => {
    let shouldFail = false;
    const write = vi.fn(async () => {
      if (shouldFail) throw new Error('cancel rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: true, dispatchComplete: true });

    shouldFail = true;
    await useLaserStore.getState().disconnect();

    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'disconnect',
    });
    expect(getMotionOperation()).toBeNull();
  });
});

describe('laser-store motion operation lifecycle', () => {
  it('keeps Frame busy until GRBL reports motion and returns to Idle', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);

    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });

    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: true });

    connection.emitLine('<Idle|MPos:10.000,10.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toBeNull();
  });

  it('clears Frame after stable Idle reports when polling misses the Jog state', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false, dispatchComplete: true });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toBeNull();
  });

  it('does not clear Frame on stable Idle before frame writes finish dispatching', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false, dispatchComplete: false });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'frame', dispatchComplete: false });
  });

  it('sends jog-cancel and clears the active operation when cancelling Frame', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false });

    write.mockClear();
    await useLaserStore.getState().cancelJog();

    expect(write).toHaveBeenCalledWith(RT_JOG_CANCEL);
    expect(getMotionOperation()).toBeNull();
  });
});
