import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type ControllerOperationSnapshot = {
  readonly kind: string;
  readonly phase?: string;
} | null;

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

function controllerOperation(): ControllerOperationSnapshot {
  return (
    (useLaserStore.getState() as { readonly controllerOperation?: ControllerOperationSnapshot })
      .controllerOperation ?? null
  );
}

// A five-line job whose lines all fit the first RX window, so five oks reach
// 'done' and the post-job settle begins.
const JOB_GCODE = 'G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5\n';

// Mirrors DEFAULT_IDLE_TIMEOUT_MS in laser-interactive-command.ts.
const IDLE_WAIT_TIMEOUT_MS = 8_000;

async function runJobUntilSettleAwaitsIdle(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().startJob(JOB_GCODE);
  for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
  await flush();
  expect(useLaserStore.getState().streamer?.status).toBe('done');
  expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
  connection.emitLine('ok');
  await flush();
  expect(controllerOperation()).toMatchObject({
    kind: 'post-job-settle',
    phase: 'awaiting-idle',
  });
}

beforeEach(() => {
  vi.useFakeTimers();
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

describe('post-job settle failure handling', () => {
  // GRBL acks lines when they are parsed, not executed — after the last ok a
  // slow-feed job can keep the machine in Run for well over the idle-wait
  // timeout. Live status reports prove the controller is healthy, so the wait
  // must not expire while they keep arriving.
  it('keeps waiting for Idle while non-idle status reports arrive', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await runJobUntilSettleAwaitsIdle(connection);

    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(IDLE_WAIT_TIMEOUT_MS - 2_000);
      connection.emitLine('<Run|MPos:5.000,0.000,0.000|FS:600,100>');
      await flush();
    }

    expect(controllerOperation()).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });
    expect(useLaserStore.getState().safetyNotice).toBeNull();

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(controllerOperation()).toBeNull();
  });

  // A settle that really fails (status silence — dead or wedged link) must
  // not park the store in a permanently-blocking operation: every command,
  // including Disconnect, gates on controllerOperation being null.
  it('clears the operation on failure and releases the job at the next Idle', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await runJobUntilSettleAwaitsIdle(connection);

    vi.advanceTimersByTime(IDLE_WAIT_TIMEOUT_MS + 1);
    await flush();

    expect(controllerOperation()).toBeNull();
    expect(useLaserStore.getState().safetyNotice).not.toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('done');

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(useLaserStore.getState().streamer).toBeNull();
  });
});
