import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_RESUME } from '../../core/controllers/grbl';
import { RT_SAFETY_DOOR } from '../../core/controllers/grbl/commands';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { canvasJobTimingPlan } from './canvas-job-timing-plan';
import type { CanvasMotionPlan } from './canvas-motion-plan';

import { useLaserStore } from './laser-store';
import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

const END_STREAM_GCODE = 'G21\nG90\nM4 S0\nG1 X1 F600 S100\nM5';
const ORIGIN = { x: 0, y: 0, z: 0 };

function countdownCanvasPlan(gcode: string): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, {
      machineKind: 'laser',
      initialPosition: ORIGIN,
    }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'pause-resume-countdown',
    machineKind: 'laser',
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

function makeConnection(
  write: (data: string) => Promise<void>,
  autoAckStartFence = true,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      const acknowledgeFence = autoAckStartFence
        ? captureTestLaserStartFenceAck(data, emit)
        : undefined;
      await write(data);
      acknowledgeFence?.();
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
      requestPort: async () => ({
        open: async () => connection,
      }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  connection.emitLine('ok');
  await flushConnect();
}

async function flushConnect(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
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
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

type SettlePhase = 'dwell' | 'awaiting-idle' | 'completion-continuation';

function expectPausedTail(phase: SettlePhase): void {
  const state = useLaserStore.getState();
  expect(state.streamer?.status).toBe('paused');
  expect(state.liveCanvasRun?.timing?.kind).toBe(phase === 'dwell' ? 'paused' : 'finishing');
}

function expectResumedTail(phase: SettlePhase): void {
  const state = useLaserStore.getState();
  expect(state.streamer?.status).toBe('done');
  expect(state.liveCanvasRun?.timing?.kind).toBe(phase === 'dwell' ? 'running' : 'finishing');
}

describe('paused job completion', () => {
  it.each(['dwell', 'awaiting-idle', 'completion-continuation'] as const)(
    'finishes after pausing the acknowledged tail during %s',
    async (settlePhase) => {
      const writes: string[] = [];
      let stateLine = '<Run|MPos:1.000,0.000,0.000|FS:1000,100|Ov:100,100,100|A:C>';
      const connection = makeConnection(async (data) => {
        writes.push(data);
        if (data === RT_SAFETY_DOOR) {
          stateLine = '<Door:0|MPos:1.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
        }
        if (data === RT_RESUME) {
          stateLine = '<Run|MPos:1.000,0.000,0.000|FS:1000,100|Ov:100,100,100|A:C>';
        }
        if (data === '?') connection.emitLine(stateLine);
      });
      await connectWith(connection);
      useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
      await startTestLaserJob(END_STREAM_GCODE, {
        canvasPlan: countdownCanvasPlan(END_STREAM_GCODE),
        jobTimingPlan: countdownTimingPlan(END_STREAM_GCODE),
      });
      for (let index = 0; index < 5; index += 1) connection.emitLine('ok');
      connection.emitLine(stateLine);
      await flushConnect();
      expect(useLaserStore.getState().streamer?.status).toBe('done');
      if (settlePhase !== 'dwell') {
        connection.emitLine('ok');
        await flushConnect();
      }
      writes.length = 0;

      if (settlePhase === 'completion-continuation') {
        connection.emitLine('<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
      }
      const pausing = useLaserStore.getState().pauseJob();
      if (settlePhase === 'completion-continuation') {
        // Pause's refill handback continuation is queued before the second
        // Idle resolves the settlement promise. It freezes the sender first.
        connection.emitLine('<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
      }
      await pausing;

      expect(writes).toContain(RT_SAFETY_DOOR);
      expectPausedTail(settlePhase);

      if (settlePhase === 'dwell') {
        connection.emitLine('ok');
        await flushConnect();
      }
      expect(useLaserStore.getState().controllerOperation).toMatchObject({
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
      });
      // Stream-side pauses can also report Idle; neither kind of paused tail
      // may be mistaken for successful completion before Resume.
      connection.emitLine('<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
      connection.emitLine('<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
      await flushConnect();
      expect(useLaserStore.getState().streamer?.status).toBe('paused');

      writes.length = 0;
      await useLaserStore.getState().resumeJob();

      expect(writes).toContain(RT_RESUME);
      expectResumedTail(settlePhase);
      expect(writes.some((data) => data.includes('G1 X'))).toBe(false);
      stateLine = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
      connection.emitLine(stateLine);
      await flushConnect();
      expect(useLaserStore.getState().streamer?.status).toBe('done');
      connection.emitLine(stateLine);
      await flushConnect();
      expect(useLaserStore.getState().streamer).toBeNull();
      expect(useLaserStore.getState().controllerOperation).toBeNull();
    },
  );
});
