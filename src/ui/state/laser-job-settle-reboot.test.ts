import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { laserCountdownTestHandoff } from './laser-countdown-test-handoff';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};
let liveConnection: FakeConnection | null = null;

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

async function connectReady(): Promise<FakeConnection> {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  const connection: FakeConnection = {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emitLine);
      if (data === '$I\n') {
        emitLine('[VER:1.1h.20190830:test]');
        emitLine('[OPT:VM,15,128]');
        emitLine('ok');
      }
      if (data === '$G\n') {
        emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emitLine('ok');
      }
      if (data === '$$\n') {
        emitLine('$30=1000');
        emitLine('$31=0');
        emitLine('$32=1');
        emitLine('ok');
      }
      acknowledgeStartFence();
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => undefined,
    emitLine,
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
  liveConnection = connection;
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  await useLaserStore.getState().connect(adapter);
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0,0,0|FS:0,0>');
  await flush();
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  return connection;
}

const JOB = 'G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5\n';

async function startAndAcknowledgeJob(connection: FakeConnection): Promise<void> {
  await startTestLaserJob(JOB, {
    ...laserCountdownTestHandoff({
      gcode: JOB,
      retentionKey: 'job-settle-reboot',
      capability: 'realtime',
    }),
  });
  for (let i = 0; i < 5; i++) connection.emitLine('ok');
  await flush();
  expect(useLaserStore.getState().streamer?.status).toBe('done');
  expect(useLaserStore.getState().controllerOperation).toMatchObject({
    kind: 'post-job-settle',
    phase: 'dwell',
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  liveConnection?.emitClose();
  liveConnection = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('controller reboot before job settlement', () => {
  it.each(['dwell', 'awaiting-idle'] as const)(
    'keeps a rebooted %s tail interrupted when the new controller later reports Idle',
    async (phase) => {
      const connection = await connectReady();
      await startAndAcknowledgeJob(connection);
      if (phase === 'awaiting-idle') {
        connection.emitLine('ok');
        await flush();
        connection.emitLine('<Idle|MPos:10,0,0|FS:0,0>');
        await flush();
        expect(useLaserStore.getState().controllerOperation).toMatchObject({
          kind: 'post-job-settle',
          phase,
        });
        expect(useLaserStore.getState().liveCanvasRun).toMatchObject({
          lifecycle: 'running',
          endedAtMs: null,
          timing: { kind: 'finishing' },
        });
      }

      connection.emitLine('Grbl 1.1f');
      await flush();

      expect(useLaserStore.getState()).toMatchObject({
        streamer: { status: 'errored', inFlight: [] },
        controllerOperation: null,
        safetyNotice: { kind: 'controller-reboot' },
        liveCanvasRun: { lifecycle: 'errored', timing: { kind: 'unavailable' } },
      });

      connection.emitLine('<Idle|MPos:5,0,0|FS:0,0>');
      connection.emitLine('<Idle|MPos:5,0,0|FS:0,0>');
      await flush();

      expect(useLaserStore.getState().streamer).toBeNull();
      expect(useLaserStore.getState().safetyNotice?.kind).toBe('controller-reboot');
      expect(useLaserStore.getState().liveCanvasRun).toMatchObject({
        lifecycle: 'errored',
        timing: { kind: 'unavailable' },
      });
    },
  );

  it('records a rejected drain marker as a terminal fault and retains it through later Idle', async () => {
    const connection = await connectReady();
    await startAndAcknowledgeJob(connection);
    connection.emitLine('error:7');
    await flush();
    const fault = useLaserStore.getState().liveCanvasRun;
    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: null,
      streamer: { status: 'done' },
      liveCanvasRun: {
        lifecycle: 'errored',
        endedAtMs: expect.any(Number),
        timing: {
          kind: 'unavailable',
          reason: 'controller completion settlement could not be confirmed',
        },
      },
    });

    connection.emitLine('<Idle|MPos:5,0,0|FS:0,0>');
    connection.emitLine('<Idle|MPos:5,0,0|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().liveCanvasRun).toEqual(fault);
  });

  it('records an accepted Abort while the settled tail is still awaiting stable Idle', async () => {
    const connection = await connectReady();
    await startAndAcknowledgeJob(connection);
    connection.emitLine('ok');
    await flush();
    connection.emitLine('<Idle|MPos:10,0,0|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });

    await useLaserStore.getState().stopJob();
    await flush();
    const stopped = useLaserStore.getState().liveCanvasRun;
    expect(stopped).toMatchObject({
      lifecycle: 'stopped',
      endedAtMs: expect.any(Number),
      timing: { kind: 'unavailable', reason: 'job stopped' },
    });
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:5,0,0|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().liveCanvasRun).toEqual(stopped);
  });

  it('does not turn a later idle reboot into a fault for an already settled job', async () => {
    const connection = await connectReady();
    await startAndAcknowledgeJob(connection);
    connection.emitLine('ok');
    await flush();
    connection.emitLine('<Idle|MPos:10,0,0|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().liveCanvasRun).toMatchObject({
      lifecycle: 'running',
      endedAtMs: null,
      timing: { kind: 'finishing' },
    });
    await vi.advanceTimersByTimeAsync(100);
    const settledAtMs = Date.now();
    connection.emitLine('<Idle|MPos:10,0,0|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().streamer).toBeNull();
    const completed = useLaserStore.getState().liveCanvasRun;
    expect(completed).toMatchObject({
      lifecycle: 'finished',
      endedAtMs: settledAtMs,
      timing: { kind: 'complete' },
      route: { candidates: [], uncertain: false },
    });
    expect(completed?.route.confirmedRouteMm).toBe(completed?.plan.manifest.totalRouteMm);

    connection.emitLine('Grbl 1.1f');
    await flush();

    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('complete');
    expect(useLaserStore.getState().liveCanvasRun).toEqual(completed);
  });
});
