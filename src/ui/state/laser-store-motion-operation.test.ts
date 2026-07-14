import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

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
  useStore.getState().setMachineKind('laser');
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
  it('keeps Jog busy until GRBL reports motion and returns to Idle', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });

    expect(getMotionOperation()).toMatchObject({ kind: 'jog', sawControllerBusy: false });

    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'jog', sawControllerBusy: true });

    connection.emitLine('<Idle|MPos:10.000,10.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toBeNull();
  });

  it('dispatches Frame jog legs one at a time after each leg completes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
    ]);
    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });

    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
      '$J=G90 G21 X10.000 Y0.000 F1000\n',
    ]);
    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });
  });

  it('retracts to safe Z, then queues a restore to the pre-frame Z, when work Z is set (CNC)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    // A current work-Z zero plus a WPos-bearing Idle so the pre-frame Z is known.
    useLaserStore.setState({
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 1 },
      workZReferenceEpoch: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);

    // Default CNC safe Z is 3.81 mm above stock top; the retract must complete
    // before any XY leg so the bit is clear of the material.
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual(['$J=G90 G21 Z3.810 F1000\n']);
    // The queued tail ends with a restore back to the pre-frame Z (Z0) so the
    // bit does not stay parked at safe height (ADR-192).
    const pending = (
      useLaserStore.getState() as {
        readonly motionOperation: { readonly pendingLines: ReadonlyArray<string> } | null;
      }
    ).motionOperation?.pendingLines;
    expect(pending?.[pending.length - 1]).toBe('$J=G90 G21 Z0.000 F1000\n');
  });

  it('frames XY-only with no Z retract when no work-Z zero is set (CNC)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    useLaserStore.setState({
      workZZeroEvidence: null,
      workZReferenceEpoch: 0,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);

    // Without a work-Z zero the work-frame retract could target an arbitrary
    // physical height, so framing is XY-only (ADR-192): the first line is an XY leg.
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
    ]);
  });

  it('stops dispatching Frame legs after the controller rejects a jog command', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);
    connection.emitLine('error:7002009');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
    ]);
    expect(getMotionOperation()).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'controller-error',
      raw: 'error:7002009',
    });
    expect(useLaserStore.getState().safetyNotice?.message).toMatch(/rejected a frame command/i);
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

  it('clears the active operation even when jog-cancel write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('cancel rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false });

    await expect(useLaserStore.getState().cancelJog()).rejects.toThrow('cancel rejected');

    expect(getMotionOperation()).toBeNull();
  });
});
