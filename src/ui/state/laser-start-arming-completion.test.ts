import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import type { HostedStreamRefill, PlatformAdapter, SerialConnection } from '../../platform/types';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { respondToTestGrblHandshake, startTestLaserJob } from './laser-test-start-helpers';
import { RecoveryRepository } from './recovery';
import { MemoryRecoveryStorageBackend } from './recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from './recovery/testing/execution-artifact-test-fixture';
import { useStore } from './store';

const GCODE = 'G21\nG90\nM4 S0\nG1 X1 S100\nM5\n';
const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:>';
const MARKER = 'G4 P0.01\n';
const NOW = '2026-09-22T01:00:00.000Z';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };
type WriteBehavior = { beforeWrite?: (data: string) => Promise<void> };
let uninstall: (() => void) | undefined;

function deferred() {
  let resolve = (): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function makeConnection(
  writes: string[],
  behavior: WriteBehavior,
  hostedStreaming?: HostedStreamRefill,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      await behavior.beforeWrite?.(data);
      if (data === '\x18') emitLine('Grbl 1.1f');
      respondToTestGrblHandshake(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
    ...(hostedStreaming === undefined ? {} : { hostedStreaming }),
  };
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
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

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine(IDLE);
  await vi.waitFor(() =>
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ phase: 'settings' }),
  );
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

function finishJobAcks(connection: FakeConnection): void {
  for (let index = 0; index < 5; index += 1) connection.emitLine('ok');
  connection.emitLine(IDLE);
}

async function trackRun(runId: string) {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
  await repository.initialize();
  await repository.stageArtifact(
    await createCurrentTestExecutionArtifact({ runId, gcode: GCODE, createdAtIso: NOW }),
  );
  await repository.activateFreshRun(runId, NOW);
  const onCompleted = vi.fn();
  uninstall = installJobCheckpointTracking(() => NOW, repository, vi.fn(), onCompleted);
  return { repository, onCompleted };
}

function pendingRefill(arm: HostedStreamRefill['arm']): HostedStreamRefill {
  return {
    isArmed: () => false,
    arm,
    release: async () => undefined,
    onWriteError: () => () => undefined,
  };
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  uninstall?.();
  uninstall = undefined;
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('completion during the Start reservation', () => {
  it.each(['first write', 'hosted arm'] as const)(
    'confirms a tiny run only after marker and two fresh Idle reports when ACKs precede %s return',
    async (boundary) => {
      const writes: string[] = [];
      const pending = deferred();
      const behavior: WriteBehavior = {};
      const refill = pendingRefill(async () => {
        finishJobAcks(connection);
        await pending.promise;
      });
      const connection = makeConnection(
        writes,
        behavior,
        boundary === 'hosted arm' ? refill : undefined,
      );
      await connectReady(connection);
      const runId = `tiny-${boundary}`;
      const { repository, onCompleted } = await trackRun(runId);
      writes.length = 0;
      if (boundary === 'first write') {
        behavior.beforeWrite = async (data) => {
          if (data !== GCODE) return;
          finishJobAcks(connection);
          await pending.promise;
        };
      }

      const starting = startTestLaserJob(GCODE, { runId });
      await vi.waitFor(() => expect(useLaserStore.getState().streamer?.status).toBe('done'));
      expect(useLaserStore.getState().controllerOperation?.kind).toBe('start-arming');
      expect(writes).not.toContain(MARKER);
      expect(onCompleted).not.toHaveBeenCalled();

      pending.resolve();
      await starting;
      expect(useLaserStore.getState().controllerOperation).toMatchObject({
        kind: 'post-job-settle',
        phase: 'dwell',
      });
      expect(writes.filter((data) => data === MARKER)).toHaveLength(1);
      connection.emitLine(IDLE);
      connection.emitLine(IDLE);
      await flush();
      expect(useLaserStore.getState().streamer?.status).toBe('done');
      expect(onCompleted).not.toHaveBeenCalled();

      connection.emitLine('ok');
      await flush();
      expect(useLaserStore.getState().controllerOperation).toMatchObject({
        phase: 'awaiting-idle',
      });
      connection.emitLine(IDLE);
      await flush();
      expect(useLaserStore.getState().streamer?.status).toBe('done');
      expect(onCompleted).not.toHaveBeenCalled();
      connection.emitLine(IDLE);
      await vi.waitFor(() => expect(onCompleted.mock.calls).toEqual([[runId]]));
      expect(useLaserStore.getState().streamer).toBeNull();
      expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId);
      expect(repository.getSnapshot().recoveryCapsule).toBeNull();
      connection.emitLine(IDLE);
      await flush();
      expect(onCompleted).toHaveBeenCalledOnce();
    },
  );

  it.each(['first write', 'hosted arm'] as const)(
    'does not settle or publish when %s rejects after all program ACKs',
    async (boundary) => {
      const writes: string[] = [];
      const behavior: WriteBehavior = {};
      const failAfterAcks = async (): Promise<void> => {
        finishJobAcks(connection);
        throw new Error('uncertain Start acceptance');
      };
      const connection = makeConnection(
        writes,
        behavior,
        boundary === 'hosted arm' ? pendingRefill(failAfterAcks) : undefined,
      );
      await connectReady(connection);
      const { repository, onCompleted } = await trackRun(`failed-${boundary}`);
      writes.length = 0;
      if (boundary === 'first write') {
        behavior.beforeWrite = async (data) => {
          if (data === GCODE) await failAfterAcks();
        };
      }

      await expect(startTestLaserJob(GCODE, { runId: `failed-${boundary}` })).rejects.toThrow(
        'uncertain Start acceptance',
      );
      connection.emitLine(IDLE);
      connection.emitLine(IDLE);
      await flush();
      expect(writes).not.toContain(MARKER);
      expect(onCompleted).not.toHaveBeenCalled();
      expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    },
  );

  it.each(['run', 'session'] as const)(
    'does not settle or release a replacement %s when an older accepted arm returns',
    async (replacement) => {
      const writes: string[] = [];
      const pending = deferred();
      const connection = makeConnection(
        writes,
        {},
        pendingRefill(async () => {
          finishJobAcks(connection);
          await pending.promise;
        }),
      );
      await connectReady(connection);
      const { onCompleted } = await trackRun('older-run');
      writes.length = 0;
      const starting = startTestLaserJob(GCODE, { runId: 'older-run' });
      await vi.waitFor(() => expect(useLaserStore.getState().streamer?.status).toBe('done'));
      const state = useLaserStore.getState();
      const operation = { kind: 'start-arming', phase: 'queue-fence' } as const;
      const streamer =
        replacement === 'run' ? step(createStreamer('G1 X99\n')).state : state.streamer;
      useLaserStore.setState({
        streamer,
        streamerEpoch: state.streamerEpoch + (replacement === 'run' ? 1 : 0),
        controllerSessionEpoch: state.controllerSessionEpoch + (replacement === 'session' ? 1 : 0),
        activeRunId: replacement === 'run' ? 'newer-run' : state.activeRunId,
        controllerOperation: operation,
      });

      pending.resolve();
      await starting;
      expect(useLaserStore.getState().controllerOperation).toBe(operation);
      expect(useLaserStore.getState().streamer).toBe(streamer);
      expect(writes).not.toContain(MARKER);
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it.each(['resolves', 'rejects'] as const)(
    'leaves a replacement run alone when the old first write %s late',
    async (outcome) => {
      const writes: string[] = [];
      const pending = deferred();
      const behavior: WriteBehavior = {};
      const arm = vi.fn(async () => undefined);
      const connection = makeConnection(writes, behavior, pendingRefill(arm));
      await connectReady(connection);
      const { onCompleted } = await trackRun('older-write');
      behavior.beforeWrite = async (data) => {
        if (data !== GCODE) return;
        finishJobAcks(connection);
        await pending.promise;
      };
      writes.length = 0;
      const starting = startTestLaserJob(GCODE, { runId: 'older-write' });
      await vi.waitFor(() => expect(useLaserStore.getState().streamer?.status).toBe('done'));
      const streamer = step(createStreamer('G1 X99\n')).state;
      const operation = { kind: 'start-arming', phase: 'queue-fence' } as const;
      useLaserStore.setState((state) => ({
        streamer,
        streamerEpoch: state.streamerEpoch + 1,
        activeRunId: 'replacement-write',
        controllerOperation: operation,
      }));
      if (outcome === 'rejects') {
        pending.reject(new Error('old first write failed'));
        await expect(starting).rejects.toThrow('old first write failed');
      } else {
        pending.resolve();
        await starting;
      }
      expect(useLaserStore.getState().controllerOperation).toBe(operation);
      expect(useLaserStore.getState().streamer).toBe(streamer);
      expect(arm).not.toHaveBeenCalled();
      expect(writes).not.toContain(MARKER);
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it('releases its pre-wire reservation without settlement when final authorization rejects', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, {});
    await connectReady(connection);
    const { onCompleted } = await trackRun('never-started');
    writes.length = 0;
    useLaserStore.setState({ activeRunId: 'previous-receipt-finishing' });

    await expect(
      startTestLaserJob(GCODE, {
        runId: 'never-started',
        assertFinalStartAuthorized: () => {
          // Previous receipt persistence may retire its ID during preparation.
          useLaserStore.setState({ activeRunId: null });
          throw new Error('source changed');
        },
      }),
    ).rejects.toThrow('source changed');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(writes).not.toContain(GCODE);
    expect(writes).not.toContain(MARKER);
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
