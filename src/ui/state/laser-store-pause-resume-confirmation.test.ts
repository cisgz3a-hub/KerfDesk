import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextQueuedLine, queuedLineCount } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { PAUSE_RESUME_TRANSITION_TIMEOUT_MS } from './laser-pause-resume-transition';
import { useLaserStore } from './laser-store';

const GRBL_SAFETY_DOOR = '\x84';
const GRBL_RESUME = '~';
const GRBL_SOFT_RESET = '\x18';
const STATUS_QUERY = '?';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      // Real GRBL answers the connect-time $G modal query (C6) with its state
      // then ok; model it so the modal query settles during connect.
      if (data === '$G\n') {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => emit(line),
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flushPromises();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushPromises();
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await flushPromises();
  // Let the detached handshake issue its post-qualification $G (C6) and the
  // fake connection auto-reply settle before the test drives more I/O.
  await flushPromises();
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function observeOutcome(promise: Promise<void>): {
  readonly outcome: () => 'pending' | 'resolved' | 'rejected';
  readonly error: () => unknown;
} {
  let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
  let error: unknown = null;
  void promise.then(
    () => {
      outcome = 'resolved';
    },
    (reason: unknown) => {
      outcome = 'rejected';
      error = reason;
    },
  );
  return { outcome: () => outcome, error: () => error };
}

function longLaserJob(): string {
  return [
    'G21',
    'G90',
    'M4 S0',
    ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`),
    'M5',
  ].join('\n');
}

function stoppedDoor(subState: number): string {
  return `<Door:${subState}|MPos:4.000,0.000,0.000|FS:0,0|Ov:100,100,100>`;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    controllerSettings: null,
    safetyNotice: null,
    lastWriteError: null,
    log: [],
  });
  vi.restoreAllMocks();
});

describe('controller-confirmed laser Pause and Resume', () => {
  it('freezes refill before Safety Door and waits for fresh settled beam-off status', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
    await useLaserStore.getState().startJob(longLaserJob());
    connection.emitLine(stoppedDoor(0));
    await flushPromises();
    writes.length = 0;

    let pauseSettled = false;
    const pause = useLaserStore
      .getState()
      .pauseJob()
      .then(() => {
        pauseSettled = true;
      });
    await flushPromises();

    expect(writes[0]).toBe(GRBL_SAFETY_DOOR);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    connection.emitLine('ok');
    await flushPromises();
    expect(writes.filter((data) => data.includes('G1 X'))).toEqual([]);

    connection.emitLine(stoppedDoor(2));
    await flushPromises();
    expect(pauseSettled).toBe(false);

    connection.emitLine(stoppedDoor(0));
    await pause;
    expect(pauseSettled).toBe(true);
  });

  it('keeps the stream frozen after cycle-start until fresh Run or Idle proof', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
    await useLaserStore.getState().startJob(longLaserJob());

    const pause = useLaserStore.getState().pauseJob();
    await flushPromises();
    connection.emitLine(stoppedDoor(0));
    await pause;
    connection.emitLine('ok');
    await flushPromises();
    writes.length = 0;

    let resumeSettled = false;
    const resume = useLaserStore
      .getState()
      .resumeJob()
      .then(() => {
        resumeSettled = true;
      });
    await flushPromises();

    expect(writes[0]).toBe(GRBL_RESUME);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(writes.filter((data) => data.includes('G1 X'))).toEqual([]);

    connection.emitLine(stoppedDoor(3));
    await flushPromises();
    expect(resumeSettled).toBe(false);
    expect(writes.filter((data) => data.includes('G1 X'))).toEqual([]);

    connection.emitLine('<Run|MPos:4.000,0.000,0.000|FS:1000,100|Ov:100,100,100|A:C>');
    await resume;
    expect(resumeSettled).toBe(true);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(writes.some((data) => data.includes('G1 X'))).toBe(true);
  });

  it('fail-dark aborts when the Safety Door transport write fails', async () => {
    let failPause = false;
    const connection = makeConnection(async (data) => {
      if (failPause && data === GRBL_SAFETY_DOOR) throw new Error('pause write failed');
    });
    await connectWith(connection);
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
    await useLaserStore.getState().startJob(longLaserJob());
    failPause = true;

    await expect(useLaserStore.getState().pauseJob()).rejects.toThrow('pause write failed');

    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'pause',
    });
  });

  it('arms confirmation before immediate query replies and allows Safety Door with unknown laser mode', async () => {
    const writes: string[] = [];
    let stateLine = stoppedDoor(0);
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === GRBL_SAFETY_DOOR) stateLine = stoppedDoor(0);
      if (data === GRBL_RESUME) {
        stateLine = '<Run|MPos:4.000,0.000,0.000|FS:1000,100|Ov:100,100,100|A:C>';
      }
      if (data === STATUS_QUERY) connection.emitLine(stateLine);
    });
    await connectWith(connection);
    useLaserStore.setState({ controllerSettings: null });
    await useLaserStore.getState().startJob(longLaserJob());

    await expect(useLaserStore.getState().pauseJob()).resolves.toBeUndefined();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    await expect(useLaserStore.getState().resumeJob()).resolves.toBeUndefined();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(writes).toContain(GRBL_SAFETY_DOOR);
    expect(writes).toContain(GRBL_RESUME);
  });

  it('fail-dark aborts when a post-confirmation resume refill fails', async () => {
    let failRefill = false;
    let stateLine = stoppedDoor(1);
    const connection = makeConnection(async (data) => {
      if (data === GRBL_SAFETY_DOOR) stateLine = stoppedDoor(1);
      if (data === GRBL_RESUME) {
        stateLine = '<Run|MPos:4.000,0.000,0.000|FS:1000,100|Ov:100,100,100|A:C>';
      }
      if (data === STATUS_QUERY) connection.emitLine(stateLine);
      if (failRefill && data.includes('G1 X')) throw new Error('resume refill rejected');
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob(longLaserJob());
    await useLaserStore.getState().pauseJob();
    for (let index = 0; index < 10; index += 1) connection.emitLine('ok');

    const paused = useLaserStore.getState().streamer;
    expect(paused?.status).toBe('paused');
    expect(paused === null ? 0 : queuedLineCount(paused)).toBeGreaterThan(0);
    const nextQueuedBytes =
      paused === null ? Number.POSITIVE_INFINITY : (nextQueuedLine(paused)?.length ?? Infinity);
    expect(
      (paused?.inFlightBytes ?? Number.POSITIVE_INFINITY) + nextQueuedBytes,
    ).toBeLessThanOrEqual(paused?.rxBufferBytes ?? 0);

    failRefill = true;
    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow('resume refill rejected');

    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'resume',
    });
  });

  it('fail-dark resets when Pause loses all controller status replies', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === GRBL_SOFT_RESET) connection.emitLine('Grbl 1.1f');
    });
    try {
      await connectWith(connection);
      await useLaserStore.getState().startJob(longLaserJob());
      writes.length = 0;

      const pause = useLaserStore.getState().pauseJob();
      const observed = observeOutcome(pause);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(PAUSE_RESUME_TRANSITION_TIMEOUT_MS);
      await flushPromises();

      expect(observed.outcome()).toBe('rejected');
      expect(observed.error()).toBeInstanceOf(Error);
      expect(writes).toContain(GRBL_SAFETY_DOOR);
      expect(writes).toContain(GRBL_SOFT_RESET);
      expect(writes).toContain('M5\n');
      expect(writes).toContain('M9\n');
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
      expect(useLaserStore.getState().safetyNotice?.kind).toBe('stream-stalled');
    } finally {
      await useLaserStore.getState().disconnect();
      vi.useRealTimers();
    }
  });

  it('bounds Resume even when Run arrives before its transport write ever settles', async () => {
    vi.useFakeTimers();
    const resumeWrite = deferred();
    const writes: string[] = [];
    let stateLine = stoppedDoor(0);
    const connection = makeConnection((data) => {
      writes.push(data);
      if (data === GRBL_SAFETY_DOOR) stateLine = stoppedDoor(0);
      if (data === GRBL_RESUME) {
        stateLine = '<Run|MPos:4.000,0.000,0.000|FS:1000,100|Ov:100,100,100|A:C>';
        connection.emitLine(stateLine);
        return resumeWrite.promise;
      }
      if (data === STATUS_QUERY) connection.emitLine(stateLine);
      if (data === GRBL_SOFT_RESET) connection.emitLine('Grbl 1.1f');
      return Promise.resolve();
    });
    try {
      await connectWith(connection);
      await useLaserStore.getState().startJob(longLaserJob());
      await useLaserStore.getState().pauseJob();
      writes.length = 0;

      const resume = useLaserStore.getState().resumeJob();
      const observed = observeOutcome(resume);
      await flushPromises();
      expect(observed.outcome()).toBe('pending');

      await vi.advanceTimersByTimeAsync(PAUSE_RESUME_TRANSITION_TIMEOUT_MS);
      await flushPromises();

      expect(observed.outcome()).toBe('rejected');
      expect(observed.error()).toBeInstanceOf(Error);
      expect(writes).toContain(GRBL_RESUME);
      expect(writes).toContain(GRBL_SOFT_RESET);
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
      const jobWriteCount = writes.filter((data) => data.includes('G1 X')).length;

      resumeWrite.resolve();
      await flushPromises();

      expect(writes.filter((data) => data.includes('G1 X'))).toHaveLength(jobWriteCount);
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    } finally {
      resumeWrite.resolve();
      await flushPromises();
      await useLaserStore.getState().disconnect();
      vi.useRealTimers();
    }
  });

  it('does not send a late status query or refill when a timed-out Pause write completes', async () => {
    vi.useFakeTimers();
    const pauseWrite = deferred();
    const writes: string[] = [];
    const connection = makeConnection((data) => {
      writes.push(data);
      if (data === GRBL_SAFETY_DOOR) return pauseWrite.promise;
      if (data === GRBL_SOFT_RESET) connection.emitLine('Grbl 1.1f');
      return Promise.resolve();
    });
    try {
      await connectWith(connection);
      await useLaserStore.getState().startJob(longLaserJob());
      writes.length = 0;

      const pause = useLaserStore.getState().pauseJob();
      const observed = observeOutcome(pause);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(PAUSE_RESUME_TRANSITION_TIMEOUT_MS);
      await flushPromises();

      expect(observed.outcome()).toBe('rejected');
      expect(writes).toContain(GRBL_SOFT_RESET);
      const queryCount = writes.filter((data) => data === STATUS_QUERY).length;
      const jobWriteCount = writes.filter((data) => data.includes('G1 X')).length;

      pauseWrite.resolve();
      await flushPromises();

      expect(writes.filter((data) => data === STATUS_QUERY)).toHaveLength(queryCount);
      expect(writes.filter((data) => data.includes('G1 X'))).toHaveLength(jobWriteCount);
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    } finally {
      pauseWrite.resolve();
      await flushPromises();
      await useLaserStore.getState().disconnect();
      vi.useRealTimers();
    }
  });

  it('lets Stop cancel a pending Resume immediately without a second reset or late refill', async () => {
    const resumeWrite = deferred();
    const writes: string[] = [];
    let autoResetBanner = false;
    let stateLine = stoppedDoor(0);
    const connection = makeConnection((data) => {
      writes.push(data);
      if (data === GRBL_SAFETY_DOOR) stateLine = stoppedDoor(0);
      if (data === GRBL_RESUME) return resumeWrite.promise;
      if (data === STATUS_QUERY) connection.emitLine(stateLine);
      if (data === GRBL_SOFT_RESET && autoResetBanner) connection.emitLine('Grbl 1.1f');
      return Promise.resolve();
    });
    try {
      await connectWith(connection);
      await useLaserStore.getState().startJob(longLaserJob());
      await useLaserStore.getState().pauseJob();
      writes.length = 0;

      const resume = useLaserStore.getState().resumeJob();
      const observed = observeOutcome(resume);
      await flushPromises();
      expect(observed.outcome()).toBe('pending');

      await useLaserStore.getState().stopJob();
      await flushPromises();

      expect(observed.outcome()).toBe('rejected');
      expect(writes.filter((data) => data === GRBL_SOFT_RESET)).toHaveLength(1);
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
      const writesAfterStop = writes.length;

      resumeWrite.resolve();
      await flushPromises();

      expect(writes).toHaveLength(writesAfterStop);
      expect(writes.some((data) => data.includes('G1 X'))).toBe(false);
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    } finally {
      autoResetBanner = true;
      connection.emitLine('Grbl 1.1f');
      resumeWrite.resolve();
      await flushPromises();
    }
  });
});
