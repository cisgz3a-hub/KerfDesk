import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { canvasJobTimingPlan } from './canvas-job-timing-plan';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

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

function countdownCanvasPlan(gcode: string): CanvasMotionPlan {
  const manifest = buildMotionManifest(gcode, {
    machineKind: 'laser',
    initialPosition: { x: 0, y: 0, z: 0 },
  });
  return {
    manifest,
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'post-job-settle-countdown',
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: { x: 0, y: 0 },
    approachFrom: { x: 0, y: 0 },
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: useLaserStore.getState().trustedPositionEpoch ?? 0,
  };
}

// Mirrors DEFAULT_IDLE_TIMEOUT_MS in laser-interactive-command.ts.
const IDLE_WAIT_TIMEOUT_MS = 8_000;
const FRESH_STATUS_INTERVAL_MS = ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS / 2;

async function runJobUntilSettleAwaitsIdle(connection: FakeConnection): Promise<void> {
  await startTestLaserJob(JOB_GCODE, {
    canvasPlan: countdownCanvasPlan(JOB_GCODE),
    jobTimingPlan: canvasJobTimingPlan(
      JOB_GCODE,
      DEFAULT_DEVICE_PROFILE,
      { x: 0, y: 0, z: 0 },
      {
        controllerSessionEpoch: useLaserStore.getState().controllerSessionEpoch,
        positionEpoch: useLaserStore.getState().trustedPositionEpoch,
        activeControllerKind: useLaserStore.getState().activeControllerKind,
        detectedControllerKind: useLaserStore.getState().detectedControllerKind,
      },
    ),
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

    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('finishing');

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState()).toMatchObject({
      streamer: { status: 'done' },
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
      },
      liveCanvasRun: { timing: { kind: 'finishing' } },
    });

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState()).toMatchObject({
      streamer: null,
      controllerOperation: null,
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
