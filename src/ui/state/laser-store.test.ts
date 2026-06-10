import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
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
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store safety notices (P0-B)', () => {
  it('raises a disconnect-during-job notice when the USB drops mid-job', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    connection.emitClose();

    expect(useLaserStore.getState().streamer?.status).toBe('disconnected');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('disconnect-during-job');
  });

  it('does not raise a notice when the port drops with no active job', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    expect(useLaserStore.getState().streamer).toBeNull();

    connection.emitClose();

    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('clearSafetyNotice acknowledges and removes the notice', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    connection.emitClose();
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();

    useLaserStore.getState().clearSafetyNotice();

    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('raises a disconnect-during-job notice when the USB drops during active Frame', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: true });

    connection.emitClose();

    expect(getMotionOperation()).toBeNull();
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('disconnect-during-job');
  });

  it('raises a disconnect-during-job notice when USB drops after a controller error', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    connection.emitLine('error:7');
    expect(useLaserStore.getState().streamer?.status).toBe('errored');

    connection.emitClose();

    expect(useLaserStore.getState().safetyNotice?.kind).toBe('disconnect-during-job');
  });
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
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'start',
    });
  });

  it('keeps an initial job ack that arrives before the first write resolves', async () => {
    const live = { connection: null as FakeConnection | null };
    const write = vi.fn(async (data: string) => {
      if (data.includes('G21')) live.connection?.emitLine('ok');
    });
    const connection = makeConnection(write);
    live.connection = connection;
    await connectWith(connection);

    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');

    expect(useLaserStore.getState().streamer?.completed).toBe(1);
    expect(useLaserStore.getState().streamer?.inFlight.map((item) => item.line)).not.toContain(
      'G21\n',
    );
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
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'pause',
    });
    shouldFail = false;
  });

  it('marks the stream unsafe when resume refill bytes fail to send', async () => {
    let failRefill = false;
    const write = vi.fn(async (data: string) => {
      if (failRefill && data.includes('G1 X')) throw new Error('resume refill rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    const gcode = [
      'G21',
      'G90',
      'M3 S0',
      ...Array.from({ length: 20 }, (_unused, i) => `G1 X${i} Y0 S10`),
      'M5',
    ].join('\n');
    await useLaserStore.getState().startJob(gcode);
    await useLaserStore.getState().pauseJob();
    for (let i = 0; i < 10; i += 1) connection.emitLine('ok');

    const paused = useLaserStore.getState().streamer;
    expect(paused?.status).toBe('paused');
    expect(paused?.queued.length).toBeGreaterThan(0);
    const nextQueuedBytes = paused?.queued[0]?.length ?? Number.POSITIVE_INFINITY;
    expect(
      (paused?.inFlightBytes ?? Number.POSITIVE_INFINITY) + nextQueuedBytes,
    ).toBeLessThanOrEqual(paused?.rxBufferBytes ?? 0);

    failRefill = true;
    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow('resume refill rejected');

    expect(useLaserStore.getState().streamer?.status).toBe('disconnected');
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'Serial write failed: resume refill rejected',
    );
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'resume',
    });
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
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'stop',
    });
    shouldFail = false;
  });

  it('sends soft reset before disconnecting an active job', async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write, close);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    write.mockClear();
    await useLaserStore.getState().disconnect();

    expect(write).toHaveBeenCalledWith(RT_SOFT_RESET);
    expect(close).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('sends soft reset before disconnecting a job stopped by controller error', async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write, close);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    connection.emitLine('error:7');
    expect(useLaserStore.getState().streamer?.status).toBe('errored');

    write.mockClear();
    await useLaserStore.getState().disconnect();

    expect(write).toHaveBeenCalledWith(RT_SOFT_RESET);
    expect(close).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it.each([
    ['Home', 'home', () => useLaserStore.getState().home()],
    ['Unlock', 'unlock', () => useLaserStore.getState().unlockAlarm()],
    ['Jog', 'jog', () => useLaserStore.getState().jog({ dx: 1, feed: 1000 })],
    ['Cancel jog', 'jog', () => useLaserStore.getState().cancelJog()],
    [
      'Frame',
      'frame',
      () => useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000),
    ],
    ['Set Origin', 'origin', () => useLaserStore.getState().setOriginHere()],
    ['Reset Origin', 'origin', () => useLaserStore.getState().resetOrigin()],
  ] as const)(
    'raises a safety notice when the %s write fails',
    async (_label, expectedAction, runCommand) => {
      const write = vi.fn(async () => {
        throw new Error(`${expectedAction} rejected`);
      });
      const connection = makeConnection(write);
      await connectWith(connection);

      await expect(runCommand()).rejects.toThrow(`${expectedAction} rejected`);

      expect(useLaserStore.getState().safetyNotice).toMatchObject({
        kind: 'write-failed',
        action: expectedAction,
      });
      if (expectedAction === 'frame') {
        expect(getMotionOperation()).toBeNull();
      }
    },
  );

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

describe('laser-store autofocus lifecycle', () => {
  it('refuses a second autofocus while one is already pending', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);

    const first = useLaserStore.getState().autofocus('$HZ1');
    await Promise.resolve();
    const second = useLaserStore.getState().autofocus('$HZ1');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    await expect(second).resolves.toMatchObject({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/auto-focus is already running/i),
    });
    await expect(first).resolves.toMatchObject({ kind: 'ok' });
  });

  it('refuses jog commands while autofocus is pending', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);

    const autofocus = useLaserStore.getState().autofocus('$HZ1');
    await Promise.resolve();

    await expect(useLaserStore.getState().jog({ dx: 1, feed: 1000 })).rejects.toThrow(
      /auto-focus is running/i,
    );
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await expect(autofocus).resolves.toMatchObject({ kind: 'ok' });
  });

  it('refuses other motion and origin actions while autofocus is busy', async () => {
    useLaserStore.setState({ autofocusBusy: true });

    await expect(useLaserStore.getState().home()).rejects.toThrow(/auto-focus is running/i);
    await expect(
      useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000),
    ).rejects.toThrow(/auto-focus is running/i);
    await expect(useLaserStore.getState().startJob('G21\nG90\nM5\n')).rejects.toThrow(
      /auto-focus is running/i,
    );
    await expect(useLaserStore.getState().setOriginHere()).rejects.toThrow(
      /auto-focus is running/i,
    );
    await expect(useLaserStore.getState().resetOrigin()).rejects.toThrow(/auto-focus is running/i);
    await expect(useLaserStore.getState().disconnect()).rejects.toThrow(/auto-focus is running/i);
  });
});

// M13 (AUDIT-2026-06-10): a line longer than the RX buffer could never send;
// startJob stored a phantom idle streamer with all lines queued, the progress
// bar froze at 0/N, and Start re-enabled - no error anywhere.
describe('startJob oversized-line guard (M13)', () => {
  it('refuses to start a job containing a line longer than the RX buffer', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const oversized = `G1 X${'9'.repeat(130)}`;
    await expect(useLaserStore.getState().startJob(`G21\n${oversized}\n`)).rejects.toThrow(
      /RX buffer/i,
    );

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(writes).toEqual([]);
  });
});
