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
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

// Eight 29-byte lines: the 120-byte first window holds four, so any stray ok
// would trigger a phantom refill past GRBL's real buffer.
const LONG_LINE = 'G1 X99.000 Y99.000 F600 S255';
const JOB_GCODE = Array.from({ length: 8 }, () => LONG_LINE).join('\n');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
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
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    frameVerification: null,
    homingState: 'unknown',
  });
  vi.restoreAllMocks();
});

// GRBL acks strictly in receive order, and every queued write earns exactly
// one ok/error. An ok owed to a console/origin/handshake write must never be
// fed to the streamer: it would free RX budget GRBL has not freed, and the
// phantom refill can overflow the real 128-byte buffer mid-burn — dropped
// bytes, corrupted G-code, live beam.
describe('untracked-ack start guard', () => {
  it('a stale console ok cannot advance a freshly started job', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    await useLaserStore.getState().sendConsoleCommand('G92 X0 Y0');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    const started = useLaserStore.getState().startJob(JOB_GCODE);
    await flush();
    // The stale ack arrives while Start is draining the pending window.
    connection.emitLine('ok');
    await started;
    await flush();

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    const streamer = useLaserStore.getState().streamer;
    expect(streamer?.status).toBe('streaming');
    // The stale ok must not have popped a job line or triggered a refill.
    expect(streamer?.completed).toBe(0);
    expect(streamer?.inFlight.length).toBe(4);
  });

  it('start fails with a clear message if the pending ack never arrives', async () => {
    vi.useFakeTimers();
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    await useLaserStore.getState().sendConsoleCommand('G92 X0 Y0');
    const started = useLaserStore.getState().startJob(JOB_GCODE);
    const failure = expect(started).rejects.toThrow(/acknowledge/i);
    await vi.advanceTimersByTimeAsync(2_000);
    await failure;

    expect(useLaserStore.getState().streamer).toBeNull();
  });

  it('an alarm clears the pending-ack counter', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    await useLaserStore.getState().sendConsoleCommand('G92 X0 Y0');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ALARM:1');
    await flush();

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('a late old-session write rejection cannot subtract a new-session ack', async () => {
    let rejectOldWrite!: (reason: Error) => void;
    let holdOldWrite = false;
    const oldWrite = new Promise<void>((_resolve, reject) => {
      rejectOldWrite = reject;
    });
    const oldConnection = makeConnection(async (data) => {
      if (holdOldWrite && data === '$I\n') await oldWrite;
    });
    await connectWith(oldConnection);
    holdOldWrite = true;

    const oldCommand = useLaserStore
      .getState()
      .sendConsoleCommand('$I')
      .catch((error: unknown) => error);
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    await useLaserStore.getState().disconnect();

    const newConnection = makeConnection(async () => undefined);
    await connectWith(newConnection);
    const newCommand = useLaserStore.getState().sendConsoleCommand('$I');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    rejectOldWrite(new Error('old port failed late'));
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    newConnection.emitLine('ok');
    await expect(newCommand).resolves.toBeUndefined();
    await expect(oldCommand).resolves.toBeInstanceOf(Error);
  });

  it('a status-only Alarm epochs out a pending write before unlock owns an ack', async () => {
    let rejectOldWrite!: (reason: Error) => void;
    let holdOldWrite = false;
    const oldWrite = new Promise<void>((_resolve, reject) => {
      rejectOldWrite = reject;
    });
    const connection = makeConnection(async (data) => {
      if (holdOldWrite && data === '$I\n') await oldWrite;
    });
    await connectWith(connection);
    holdOldWrite = true;

    const oldCommand = useLaserStore
      .getState()
      .sendConsoleCommand('$I')
      .catch((error: unknown) => error);
    await flush();
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    await useLaserStore.getState().unlockAlarm();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    rejectOldWrite(new Error('old status-era write failed late'));
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ok');
    await expect(oldCommand).resolves.toBeInstanceOf(Error);
  });
});

// Audit F1: one physical ok must never settle BOTH ledgers. While the
// streamer still has unsettled acks, the earliest terminal ack belongs to
// the stream (GRBL-family firmwares ack in strict receive order) and the
// untracked counter must not move — otherwise Start's arming gate opens one
// ack early and the last stop-cleanup ok phantom-advances the next job.
describe('stop-path ack attribution', () => {
  async function connectMarlinWith(connection: FakeConnection): Promise<void> {
    await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind: 'marlin' });
    connection.emitLine('start');
    await flush();
  }

  // Marlin stop is stream-side: no soft reset exists, so the in-flight job
  // line AND the M5/M107 beam-off lines all still ack after cancel.
  it('a stream-owned ok does not settle the untracked ledger (Marlin stop)', async () => {
    const connection = makeConnection(async () => undefined);
    await connectMarlinWith(connection);

    await useLaserStore
      .getState()
      .startJob('G1 X1 S100\nG1 X2 S100\nG1 X3 S100', { streamingMode: 'ping-pong' });
    await flush();
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(1);

    await useLaserStore.getState().stopJob();
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);

    connection.emitLine('ok'); // the in-flight job line — stream-owned
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);

    connection.emitLine('ok'); // M5
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ok'); // M107
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('a stale stop-cleanup ok cannot advance the next job (Marlin stop)', async () => {
    const connection = makeConnection(async () => undefined);
    await connectMarlinWith(connection);

    await useLaserStore
      .getState()
      .startJob('G1 X1 S100\nG1 X2 S100\nG1 X3 S100', { streamingMode: 'ping-pong' });
    await flush();
    await useLaserStore.getState().stopJob();

    connection.emitLine('ok'); // in-flight job line
    connection.emitLine('ok'); // M5
    await flush();

    // M107's ok is still owed. Start must wait for it; once it lands it
    // belongs to the ledger, never to the new stream.
    const started = useLaserStore
      .getState()
      .startJob('G1 X9 S100\nG1 X8 S100', { streamingMode: 'ping-pong' });
    await flush();
    connection.emitLine('ok'); // M107
    await started;
    await flush();

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    const streamer = useLaserStore.getState().streamer;
    expect(streamer?.status).toBe('streaming');
    expect(streamer?.completed).toBe(0);
    expect(streamer?.inFlight).toHaveLength(1);
  });

  // GRBL stop: the soft reset wipes the firmware's RX buffer, so the
  // in-flight lines will never be acked and the streamer drops them at stop
  // time. The M9 beam-off cleanup is deferred until the boot banner (audit
  // F2) so its ok can neither be swallowed mid-boot nor orphaned by the
  // banner's ledger reset.
  it('GRBL stop defers M9 to the boot banner; its ok settles the ledger, not the stream', async () => {
    const written: string[] = [];
    const connection = makeConnection(async (data) => {
      written.push(data);
    });
    await connectWith(connection);

    await useLaserStore.getState().startJob(JOB_GCODE);
    await flush();
    expect(useLaserStore.getState().streamer?.inFlight.length).toBeGreaterThan(0);

    await useLaserStore.getState().stopJob();
    const stopped = useLaserStore.getState().streamer;
    expect(stopped?.status).toBe('cancelled');
    expect(stopped?.inFlight).toEqual([]);
    // M9 is armed, not written: no untracked ack owed yet, nothing to jam.
    expect(written).not.toContain('M9\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    connection.emitLine('Grbl 1.1f'); // boot banner after the soft reset
    await flush();
    expect(written).toContain('M9\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ok'); // M9 cleanup ack — post-boot, unambiguous
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().streamer?.completed).toBe(0);
  });

  // Audit F3: the Marlin/Smoothie jog is a multi-line payload (G21, G91,
  // G0, G90) written in one call — the firmware acks each line, so the
  // ledger must count every one, or orphan oks drift into the next job's
  // accounting.
  it('a multi-line jog payload owes one ack per line (Marlin)', async () => {
    const connection = makeConnection(async () => undefined);
    await connectMarlinWith(connection);
    connection.emitLine('X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0');
    await flush();
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await useLaserStore.getState().jog({ dx: 5, feed: 600 });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(4);

    connection.emitLine('ok'); // G21
    connection.emitLine('ok'); // G91
    connection.emitLine('ok'); // G0
    connection.emitLine('ok'); // G90
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  // Audit F2: a banner while the stream is live = uncommanded controller
  // reboot. Buffered motion is gone; the job must end NOW, not when the
  // stall watchdog gives up 10-90 s later.
  it('an uncommanded boot banner mid-job errors the stream and raises a notice', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    await useLaserStore.getState().startJob(JOB_GCODE);
    await flush();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    connection.emitLine('Grbl 1.1f'); // spontaneous reboot — no Stop was sent
    await flush();

    const streamer = useLaserStore.getState().streamer;
    expect(streamer?.status).toBe('errored');
    expect(streamer?.inFlight).toEqual([]);
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('controller-reboot');
  });
});
