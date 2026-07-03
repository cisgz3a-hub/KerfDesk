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
});
