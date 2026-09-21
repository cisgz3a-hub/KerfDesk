import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const NOW = '2026-09-22T01:00:00.000Z';
const LATER = '2026-09-22T01:01:00.000Z';
const GCODE = Array.from({ length: 60 }, (_, index) => `G1 X${index} S100`).join('\n');
const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

function repository(backend = new MemoryRecoveryStorageBackend()): RecoveryRepository {
  return new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

async function stage(repo: RecoveryRepository, runId: string): Promise<void> {
  await repo.stageArtifact(
    await createCurrentTestExecutionArtifact({ runId, gcode: GCODE, createdAtIso: NOW }),
  );
}

function beginStream(runId: string): void {
  useLaserStore.setState({
    activeRunId: runId,
    streamer: step(createStreamer(GCODE)).state,
    connection: { kind: 'connected' },
    statusReport: IDLE,
  });
}

async function start(repo: RecoveryRepository, runId: string): Promise<void> {
  await stage(repo, runId);
  await repo.activateFreshRun(runId, NOW);
  beginStream(runId);
}

function finishAcknowledgements(): void {
  const streamer = useLaserStore.getState().streamer as StreamerState;
  useLaserStore.setState({
    streamer: { ...streamer, completed: 60, status: 'done' },
    controllerOperation: {
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
      idleReports: 2,
    },
  });
}

function settle(): void {
  finishAcknowledgements();
  useLaserStore.setState({ streamer: null, controllerOperation: null, statusReport: IDLE });
}

async function flushQueuedWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('live job completion offers', () => {
  it('publishes once after clean settlement, never when the final line is merely acknowledged', async () => {
    const repo = repository();
    const onCompleted = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, vi.fn(), onCompleted);
    await start(repo, 'completed-live');

    finishAcknowledgements();
    await flushQueuedWork();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();

    useLaserStore.setState({ streamer: null, controllerOperation: null });
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith('completed-live'));
    expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('completed-live');
    useLaserStore.setState({ statusReport: { ...IDLE } });
    await flushQueuedWork();
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('does not turn a hydrated historical receipt into a new completion event', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const previousSession = repository(backend);
    await previousSession.initialize();
    await stage(previousSession, 'completed-previous-session');
    await previousSession.activateFreshRun('completed-previous-session', NOW);
    await previousSession.completeRun('completed-previous-session', LATER);

    const nextSession = repository(backend);
    const onCompleted = vi.fn();
    uninstall = installJobCheckpointTracking(() => LATER, nextSession, vi.fn(), onCompleted);
    await nextSession.initialize();
    expect(nextSession.getSnapshot().lastCompletedReceipt?.runId).toBe(
      'completed-previous-session',
    );
    useLaserStore.setState({ statusReport: IDLE });
    await flushQueuedWork();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('does not offer a second pass when done disappears without controller settlement', async () => {
    const repo = repository();
    const onCompleted = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, vi.fn(), onCompleted);
    await start(repo, 'unsettled-done');
    const streamer = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({ streamer: { ...streamer, completed: 60, status: 'done' } });
    useLaserStore.setState({ streamer: null });

    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('unsettled-done'),
    );
    await flushQueuedWork();
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'disconnected'] as const)(
    'does not publish completion after a %s stream',
    async (status) => {
      const repo = repository();
      const onCompleted = vi.fn();
      await repo.initialize();
      uninstall = installJobCheckpointTracking(() => LATER, repo, vi.fn(), onCompleted);
      await start(repo, `interrupted-${status}`);
      const streamer = useLaserStore.getState().streamer as StreamerState;
      useLaserStore.setState({ streamer: { ...streamer, completed: 20, status } });
      useLaserStore.setState({ streamer: null });

      await vi.waitFor(() =>
        expect(repo.getSnapshot().recoveryCapsule?.runId).toBe(`interrupted-${status}`),
      );
      await flushQueuedWork();
      expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
      expect(onCompleted).not.toHaveBeenCalled();
    },
  );

  it('waits for failed completion persistence to succeed on retry before publishing', async () => {
    const repo = repository();
    const onCompleted = vi.fn();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure, onCompleted);
    await start(repo, 'completion-retry');
    const failure = { ok: false, error: 'storage-unavailable' } as const;
    const completeRun = vi.spyOn(repo, 'completeRun').mockResolvedValueOnce(failure);

    settle();
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failure));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(useLaserStore.getState().activeRunId).toBe('completion-retry');

    useLaserStore.setState({ statusReport: { ...IDLE } });
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith('completion-retry'));
    expect(completeRun).toHaveBeenCalledTimes(2);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('completion-retry');
  });

  it('retains the live completion event when a tiny run awaits archive activation', async () => {
    const repo = repository();
    const onCompleted = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, vi.fn(), onCompleted);
    await stage(repo, 'tiny-deferred-completion');
    beginStream('tiny-deferred-completion');
    settle();

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith('tiny-deferred-completion'));
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    await repo.activateFreshRun('tiny-deferred-completion', NOW);
    expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('tiny-deferred-completion');
    await flushQueuedWork();
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('does not publish an older completion whose persistence resolves after a newer run starts', async () => {
    const repo = repository();
    const onCompleted = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, vi.fn(), onCompleted);
    await start(repo, 'older-run');
    let releaseOlderCompletion = (): void => undefined;
    const delayedCompletion = new Promise<void>((resolve) => {
      releaseOlderCompletion = resolve;
    });
    const completeRun = repo.completeRun.bind(repo);
    vi.spyOn(repo, 'completeRun').mockImplementationOnce(async (...args) => {
      const completed = await completeRun(...args);
      await delayedCompletion;
      return completed;
    });

    settle();
    await vi.waitFor(() =>
      expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('older-run'),
    );
    await start(repo, 'newer-run');
    releaseOlderCompletion();
    await flushQueuedWork();
    expect(useLaserStore.getState().activeRunId).toBe('newer-run');
    expect(onCompleted).not.toHaveBeenCalled();

    settle();
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith('newer-run'));
    expect(onCompleted.mock.calls).toEqual([['newer-run']]);
  });
});
