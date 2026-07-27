import { expect, vi } from 'vitest';
import { RT_RESUME } from '../../core/controllers/grbl';
import { RT_SAFETY_DOOR } from '../../core/controllers/grbl/commands';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { canvasJobTimingPlan } from '../../ui/state/canvas-job-timing-plan';
import type { CanvasMotionPlan } from '../../ui/state/canvas-motion-plan';
import {
  cncControllerEpochOf,
  createCncSetupAttestation,
} from '../../ui/state/cnc-setup-attestation';
import { useLaserStore } from '../../ui/state/laser-store';
import {
  respondToTestGrblHandshake,
  settleTestGrblHandshake,
} from '../../ui/state/laser-test-start-helpers';

export const STATUS_QUERY = '?';
const SETTLE_DWELL = 'G4 P0.01\n';
export const STOCK_PARKING_PROGRESS_MS = 3_100;
export const STOCK_SPINDLE_RESTORE_PROGRESS_MS = 4_100;
export const LONG_RESTORE_PROGRESS_MS = 8_100;
export const PROGRESS_REPORT_INTERVAL_MS = 500;
export const EXPECTED_HEARTBEAT_TIMEOUT_MS = 2_000;
export const EXPECTED_MAX_TIMEOUT_MS = 30_000;
export const BEFORE_DEADLINE_MS = 1;
export const HEALTHY_REFILL_WRITE_MS = 1_500;
export const SECOND_REFILL_WRITE_INDEX = 2;
const CONTROLLER_POLL_SETTLE_ITERATIONS = 128;
const HELD_ACKS_BEFORE_RESUME = 3;
const CNC_MOTION_LINE_COUNT = 30;
const ORIGIN = { x: 0, y: 0, z: 0 };
const CNC_GCODE = [
  'G21',
  'G90',
  'M3 S12000',
  ...Array.from({ length: CNC_MOTION_LINE_COUNT }, (_, index) => `G1 X${index + 1} F300`),
  'M5',
].join('\n');
const IDLE_STATUS = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
export const PARKING_STATUS = '<Door:2|MPos:4.000,0.000,1.000|FS:100,0|Ov:100,100,100>';
export const PARKED_STATUS = '<Door:0|MPos:4.000,0.000,5.000|FS:0,0|Ov:100,100,100>';
export const DOOR_AJAR_STATUS = '<Door:1|MPos:4.000,0.000,5.000|FS:0,0|Ov:100,100,100>';
export const RESTORING_STATUS = '<Door:3|MPos:4.000,0.000,0.000|FS:0,12000|Ov:100,100,100|A:S>';
export const RUN_STATUS = '<Run|MPos:4.000,0.000,0.000|FS:300,12000|Ov:100,100,100|A:S>';
export const WRONG_DIRECTION_PROGRESS_CASES = [
  { action: 'pause', status: RESTORING_STATUS },
  { action: 'resume', status: PARKING_STATUS },
] satisfies ReadonlyArray<{
  readonly action: 'pause' | 'resume';
  readonly status: string;
}>;

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type WriteOverride = (data: string) => Promise<void>;

export type ConnectionHarness = {
  readonly connection: FakeConnection;
  readonly writes: string[];
  readonly emitStatus: (line: string) => void;
  readonly setPauseStatus: (line: string) => void;
  readonly setResumeStatus: (line: string) => void;
  readonly setStatusResponsesEnabled: (enabled: boolean) => void;
  readonly setWriteOverride: (override: WriteOverride | null) => void;
};

type ObservedOutcome = {
  readonly result: () => 'pending' | 'resolved' | 'rejected';
  readonly error: () => unknown;
};

function countdownCanvasPlan(gcode: string): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'cnc', initialPosition: ORIGIN }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'cnc-pause-resume-progress',
    machineKind: 'cnc',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: ORIGIN },
    framePerimeter: [],
    jobStart: ORIGIN,
    approachFrom: ORIGIN,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: useLaserStore.getState().trustedPositionEpoch ?? 0,
  };
}

function countdownTimingPlan(gcode: string) {
  const laser = useLaserStore.getState();
  return canvasJobTimingPlan(gcode, DEFAULT_DEVICE_PROFILE, ORIGIN, {
    controllerSessionEpoch: laser.controllerSessionEpoch,
    positionEpoch: laser.trustedPositionEpoch,
    activeControllerKind: laser.activeControllerKind,
    detectedControllerKind: laser.detectedControllerKind,
  });
}

export function makeConnectionHarness(): ConnectionHarness {
  const writes: string[] = [];
  const lineHandlers = new Set<(line: string) => void>();
  let status = IDLE_STATUS;
  let pauseStatus = PARKED_STATUS;
  let resumeStatus = RESTORING_STATUS;
  let statusResponsesEnabled = true;
  let writeOverride: WriteOverride | null = null;
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      await writeOverride?.(data);
      respondToTestGrblHandshake(data, emitLine);
      if (data === '$$\n') {
        emitLine('$32=0');
        emitLine('ok');
      }
      if (data === SETTLE_DWELL) emitLine('ok');
      if (data === RT_SAFETY_DOOR) status = pauseStatus;
      if (data === RT_RESUME) status = resumeStatus;
      if (data === STATUS_QUERY && statusResponsesEnabled) {
        setTimeout(() => emitLine(status), 0);
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
  };
  return {
    connection,
    writes,
    emitStatus: (line) => {
      status = line;
      emitLine(line);
    },
    setPauseStatus: (line) => {
      pauseStatus = line;
    },
    setResumeStatus: (line) => {
      resumeStatus = line;
    },
    setStatusResponsesEnabled: (enabled) => {
      statusResponsesEnabled = enabled;
    },
    setWriteOverride: (override) => {
      writeOverride = override;
    },
  };
}

function adapter(connection: SerialConnection): PlatformAdapter {
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

export function observeOutcome(promise: Promise<void>): ObservedOutcome {
  let result: ReturnType<ObservedOutcome['result']> = 'pending';
  let error: unknown = null;
  void promise.then(
    () => {
      result = 'resolved';
    },
    (reason: unknown) => {
      result = 'rejected';
      error = reason;
    },
  );
  return { result: () => result, error: () => error };
}

export async function flushPromises(): Promise<void> {
  for (let index = 0; index < CONTROLLER_POLL_SETTLE_ITERATIONS; index += 1) {
    await Promise.resolve();
  }
}

export async function connectAndStartCnc(harness: ConnectionHarness): Promise<void> {
  await useLaserStore.getState().connect(adapter(harness.connection));
  harness.connection.emitLine('Grbl 1.1f');
  harness.connection.emitLine(IDLE_STATUS);
  await settleTestGrblHandshake();
  useLaserStore.setState({
    controllerSettings: { laserModeEnabled: false },
    accessoryCache: {
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    },
  });
  const controllerEpoch = cncControllerEpochOf(useLaserStore.getState());
  await useLaserStore.getState().startJob(CNC_GCODE, {
    machineKind: 'cnc',
    cncSetupAttestation: createCncSetupAttestation(CNC_GCODE, controllerEpoch),
    canvasPlan: countdownCanvasPlan(CNC_GCODE),
    jobTimingPlan: countdownTimingPlan(CNC_GCODE),
  });
  expect(useLaserStore.getState().activeJobMachineKind).toBe('cnc');
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

export async function pauseAtSettledDoor(harness: ConnectionHarness): Promise<void> {
  harness.setPauseStatus(PARKED_STATUS);
  await useLaserStore.getState().pauseJob();
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
}

export async function releaseHeldStreamCapacity(harness: ConnectionHarness): Promise<void> {
  for (let index = 0; index < HELD_ACKS_BEFORE_RESUME; index += 1) {
    harness.connection.emitLine('ok');
  }
  await flushPromises();
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
}

export async function drainPausedInFlight(harness: ConnectionHarness): Promise<void> {
  const inFlightCount = useLaserStore.getState().streamer?.inFlight.length ?? 0;
  for (let index = 0; index < inFlightCount; index += 1) {
    harness.connection.emitLine('ok');
  }
  await flushPromises();
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
}

export async function advanceWithFreshStatus(
  harness: ConnectionHarness,
  status: string,
  durationMs: number,
): Promise<void> {
  let elapsedMs = 0;
  while (elapsedMs < durationMs) {
    const stepMs = Math.min(PROGRESS_REPORT_INTERVAL_MS, durationMs - elapsedMs);
    await vi.advanceTimersByTimeAsync(stepMs);
    harness.emitStatus(status);
    await flushPromises();
    elapsedMs += stepMs;
  }
}

export function jobWriteCount(writes: readonly string[]): number {
  return writes.filter((line) => line.includes('G1 X')).length;
}

export function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
} {
  let resolve = (): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}
