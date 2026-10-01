import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { laserCountdownTestHandoff } from './laser-countdown-test-handoff';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { type LaserState, useLaserStore } from './laser-store';
import { captureTestLaserStartFenceAck } from './laser-test-start-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type ControllerOperationSnapshot = {
  readonly kind: string;
  readonly phase?: string;
} | null;

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emit);
      await write(data);
      acknowledgeStartFence();
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
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
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
const POST_JOB_COUNTDOWN_RETENTION_KEY = 'post-job-settle-countdown';
const STALE_FINISHED_JOB_STATE = {
  activeJobMachineKind: 'laser',
  pauseResumeTransition: { token: Symbol('stale-pause-resume'), action: 'resume' },
  toolChangeIdleSeen: true,
  toolChangeLabels: ['stale tool'],
  toolChangeToolIds: ['stale-tool'],
  pendingToolLabel: 'pending tool',
  pendingToolId: 'pending-tool',
} satisfies Partial<LaserState>;

// Mirrors DEFAULT_IDLE_TIMEOUT_MS in laser-interactive-command.ts.
const IDLE_WAIT_TIMEOUT_MS = 8_000;
const FRESH_STATUS_INTERVAL_MS = ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS / 2;

async function runJobUntilSettleAwaitsIdle(connection: FakeConnection): Promise<void> {
  await startTestLaserJobOnClock(JOB_GCODE, {
    ...laserCountdownTestHandoff({
      gcode: JOB_GCODE,
      retentionKey: POST_JOB_COUNTDOWN_RETENTION_KEY,
      capability: 'realtime',
    }),
  });
  for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
  await flush();
  expect(useLaserStore.getState().streamer?.status).toBe('done');
  expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
  expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('running');
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
  it('keeps the countdown finishing until the settle marker and two fresh Idle reports', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await runJobUntilSettleAwaitsIdle(connection);

    useLaserStore.setState(STALE_FINISHED_JOB_STATE);

    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('finishing');

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
      },
      ...STALE_FINISHED_JOB_STATE,
      liveCanvasRun: { timing: { kind: 'finishing' } },
    });

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      activeJobMachineKind: null,
      pauseResumeTransition: null,
      toolChangeIdleSeen: false,
      toolChangeLabels: [],
      toolChangeToolIds: [],
      pendingToolLabel: null,
      pendingToolId: null,
      liveCanvasRun: { timing: { kind: 'complete' } },
    });
  });

  // GRBL acks lines when they are parsed, not executed — after the last ok a
  // slow-feed job can keep the machine in Run for well over the idle-wait
  // timeout. Live status reports prove the controller is healthy, so the wait
  // must not expire while they keep arriving.
  it('keeps waiting for Idle while non-idle status reports arrive', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await runJobUntilSettleAwaitsIdle(connection);

    const statusIntervals = IDLE_WAIT_TIMEOUT_MS / FRESH_STATUS_INTERVAL_MS + 1;
    for (let i = 0; i < statusIntervals; i += 1) {
      await vi.advanceTimersByTimeAsync(FRESH_STATUS_INTERVAL_MS);
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

  // Status silence while GRBL may still be physically finishing is a transport
  // fault, not an ordinary settle timeout. Containment must reset/quarantine
  // the link and must not leave its recovery operation blocking the UI.
  it('contains status silence and leaves no recovery operation behind', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await runJobUntilSettleAwaitsIdle(connection);
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(
      ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + FRESH_STATUS_INTERVAL_MS / 2,
    );
    await flush();

    expect(controllerOperation()).toMatchObject({ kind: 'recovery', phase: 'reset' });
    expect(writes).toContain('\x18');

    connection.emitLine('Grbl 1.1f');
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      controllerOperation: null,
      streamer: { status: 'cancelled' },
      safetyNotice: { kind: 'stream-stalled' },
    });
    expect(writes).toContain('M5\n');
    expect(writes).toContain('M9\n');
  });
});

// Chrome runs the timers of a tab hidden for five minutes once a minute: the
// 250 ms status poll (a chained interval) sends `?` once a minute, while a
// one-off timeout armed from a serial read still fires on time. The settle's
// silence timeouts must not read the page's own throttled poll as a silent
// controller, or every job finished while Chrome was minimised was recorded as
// interrupted and never offered a second pass (ADR-356 Amendment 1).
describe('post-job settle in a throttled hidden tab', () => {
  const THROTTLED_TICK_MS = 60_000;
  let pollTick: (() => void) | null = null;

  beforeEach(() => {
    pollTick = null;
    const realSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      handler: () => void,
      delay?: number,
    ) => {
      if (delay !== 250) return realSetInterval(handler, delay);
      pollTick = handler;
      return realSetInterval(() => undefined, 1 << 30);
    }) as typeof setInterval);
  });

  function tickPoll(): void {
    if (pollTick === null) throw new Error('Expected the status poll to be running.');
    pollTick();
  }

  async function hiddenMinute(connection: FakeConnection, reply: string): Promise<void> {
    await vi.advanceTimersByTimeAsync(THROTTLED_TICK_MS);
    tickPoll();
    connection.emitLine(reply);
    await flush();
  }

  it('completes on the Idle reports of the minute-throttled poll', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    tickPoll();
    await runJobUntilSettleAwaitsIdle(connection);

    await hiddenMinute(connection, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    expect(controllerOperation()).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });
    await hiddenMinute(connection, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');

    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      safetyNotice: null,
      lastWriteError: null,
    });
  });

  it('waits for the settle marker while the final moves outlast its activity timeout', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    tickPoll();
    await startTestLaserJobOnClock(JOB_GCODE, {
      ...laserCountdownTestHandoff({
        gcode: JOB_GCODE,
        retentionKey: POST_JOB_COUNTDOWN_RETENTION_KEY,
        capability: 'realtime',
      }),
    });
    for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
    await flush();
    expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });

    await hiddenMinute(connection, '<Run|MPos:5.000,0.000,0.000|FS:600,100>');
    await vi.advanceTimersByTimeAsync(THROTTLED_TICK_MS);
    expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    connection.emitLine('ok');
    await flush();
    expect(controllerOperation()).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });
    await hiddenMinute(connection, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await hiddenMinute(connection, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');

    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
      safetyNotice: null,
    });
  });

  it('still fails a controller that stays silent once the poll runs on schedule again', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    tickPoll();
    await runJobUntilSettleAwaitsIdle(connection);

    await vi.advanceTimersByTimeAsync(THROTTLED_TICK_MS);
    // The tab is visible again: the poll ticks every 250 ms and nothing answers.
    for (let elapsed = 0; elapsed <= IDLE_WAIT_TIMEOUT_MS; elapsed += 250) {
      tickPoll();
      await vi.advanceTimersByTimeAsync(250);
    }
    await flush();

    expect(useLaserStore.getState().controllerOperation?.kind).not.toBe('post-job-settle');
  });
});
