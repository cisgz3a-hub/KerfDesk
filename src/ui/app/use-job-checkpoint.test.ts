import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  step,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const GCODE = Array.from({ length: 60 }, (_, index) => `G1 X${index} S100`).join('\n');
const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';
const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function repository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

function executionArtifact(runId: string) {
  return createCurrentTestExecutionArtifact({
    runId,
    gcode: GCODE,
    createdAtIso: NOW,
  });
}

function baseStreamer(): StreamerState {
  return step(createStreamer(GCODE)).state;
}

async function startTrackedRun(repo: RecoveryRepository, runId: string): Promise<void> {
  await repo.stageArtifact(await executionArtifact(runId));
  await repo.activateFreshRun(runId, NOW);
  useLaserStore.setState({
    activeRunId: runId,
    streamer: baseStreamer(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
  });
}

async function waitForAck(repo: RecoveryRepository, count: number): Promise<void> {
  await vi.waitFor(() => expect(repo.getSnapshot().activeRun?.ackedLines).toBe(count));
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  useLaserStore.setState(initialLaserState());
});

describe('installJobCheckpointTracking', () => {
  it('advances only the owned run at the acknowledgement interval', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-a');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({ streamer: { ...base, completed: 10 } });
    expect(repo.getSnapshot().activeRun?.ackedLines).toBe(0);
    useLaserStore.setState({ streamer: { ...base, completed: 25 } });
    await waitForAck(repo, 25);

    useLaserStore.setState({ activeRunId: 'foreign', streamer: { ...base, completed: 50 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repo.getSnapshot().activeRun?.ackedLines).toBe(25);
  });

  it('retries progress after a failed repository result instead of advancing its watermark', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-progress-retry');
    const base = useLaserStore.getState().streamer as StreamerState;
    const originalUpdateProgress = repo.updateProgress.bind(repo);
    const failureResult = { ok: false, error: 'storage-unavailable' } as const;
    let failed = false;
    const updateProgress = vi
      .spyOn(repo, 'updateProgress')
      .mockImplementation(async (runId, ackedLines, updatedAtIso) => {
        if (ackedLines === 25 && !failed) {
          failed = true;
          return failureResult;
        }
        return originalUpdateProgress(runId, ackedLines, updatedAtIso);
      });

    useLaserStore.setState({ streamer: { ...base, completed: 25 } });
    await vi.waitFor(() =>
      expect(updateProgress).toHaveBeenCalledWith('run-progress-retry', 25, LATER),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repo.getSnapshot().activeRun?.ackedLines).toBe(0);
    expect(reportFailure).toHaveBeenCalledWith(failureResult);

    useLaserStore.setState({ streamer: { ...base, completed: 26 } });
    await waitForAck(repo, 26);
    expect(updateProgress).toHaveBeenCalledWith('run-progress-retry', 26, LATER);
  });

  it('retries a terminal interruption after a failed repository result', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-terminal-retry');
    const base = useLaserStore.getState().streamer as StreamerState;
    const originalInterruptRun = repo.interruptRun.bind(repo);
    const failureResult = { ok: false, error: 'storage-unavailable' } as const;
    let failed = false;
    const interruptRun = vi
      .spyOn(repo, 'interruptRun')
      .mockImplementation(async (runId, ackedLines, interruption, updatedAtIso) => {
        if (!failed) {
          failed = true;
          return failureResult;
        }
        return originalInterruptRun(runId, ackedLines, interruption, updatedAtIso);
      });
    const terminal = {
      ...base,
      completed: 12,
      status: 'disconnected' as const,
    };

    useLaserStore.setState({
      safetyNotice: { kind: 'disconnect-during-job', message: 'USB connection was lost.' },
      streamer: terminal,
    });
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failureResult));
    useLaserStore.setState({ streamer: { ...terminal } });

    await vi.waitFor(() => expect(interruptRun).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('run-terminal-retry'),
    );
  });

  it('reports unexpected queued errors nonblockingly and keeps progress retryable', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-progress-throw');
    const base = useLaserStore.getState().streamer as StreamerState;
    const failure = new Error('Unexpected repository exception.');
    const originalUpdateProgress = repo.updateProgress.bind(repo);
    let failed = false;
    vi.spyOn(repo, 'updateProgress').mockImplementation(async (runId, ackedLines, updatedAtIso) => {
      if (ackedLines === 25 && !failed) {
        failed = true;
        throw failure;
      }
      return originalUpdateProgress(runId, ackedLines, updatedAtIso);
    });

    useLaserStore.setState({ streamer: { ...base, completed: 25 } });
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failure));
    useLaserStore.setState({ streamer: { ...base, completed: 26 } });

    await waitForAck(repo, 26);
    expect(reportFailure).toHaveBeenCalledOnce();
  });

  it('moves a terminal stream into the isolated recovery capsule', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-a');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({
      safetyNotice: { kind: 'disconnect-during-job', message: 'USB connection was lost.' },
      streamer: { ...base, completed: 12, status: 'disconnected' },
    });
    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule).toMatchObject({
        runId: 'run-a',
        ackedLines: 12,
        interruption: { kind: 'disconnect' },
      }),
    );
  });

  it('creates a replay receipt only after done settles to connected Idle', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-done');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({
      streamer: { ...base, completed: 60, status: 'done' },
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
        idleReports: 2,
      },
    });
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    useLaserStore.setState({
      streamer: null,
      controllerOperation: null,
      statusReport: IDLE_STATUS,
    });

    await vi.waitFor(() => expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('run-done'));
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('does not lose terminal settlement when a tiny run finishes before repository activation', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await repo.stageArtifact(await executionArtifact('run-tiny'));
    const base = baseStreamer();
    useLaserStore.setState({
      activeRunId: 'run-tiny',
      streamer: { ...base, completed: 60, status: 'done' },
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
        idleReports: 2,
      },
    });
    useLaserStore.setState({ streamer: null, controllerOperation: null });

    await vi.waitFor(() => expect(useLaserStore.getState().activeRunId).toBeNull());
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    await repo.activateFreshRun('run-tiny', NOW);
    await vi.waitFor(() => expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('run-tiny'));
    expect(repo.getSnapshot().activeRun).toBeNull();
  });

  it('does not create a replay receipt when done is released without settle proof', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-unsettled-done');
    const base = useLaserStore.getState().streamer as StreamerState;

    useLaserStore.setState({ streamer: { ...base, completed: 60, status: 'done' } });
    useLaserStore.setState({ streamer: null, statusReport: IDLE_STATUS });

    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('run-unsettled-done'),
    );
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('retains local run ownership when completion persistence fails', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-complete-write-failed');
    const base = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({
      streamer: { ...base, completed: 60, status: 'done' },
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
        idleReports: 2,
      },
    });
    const completeRun = vi
      .spyOn(repo, 'completeRun')
      .mockResolvedValue({ ok: false, error: 'storage-unavailable' });

    useLaserStore.setState({ streamer: null, controllerOperation: null });
    await vi.waitFor(() => expect(completeRun).toHaveBeenCalledOnce());
    expect(reportFailure).toHaveBeenCalledWith({ ok: false, error: 'storage-unavailable' });
    expect(useLaserStore.getState().activeRunId).toBe('run-complete-write-failed');
  });

  it('retains local run ownership when interruption persistence fails', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-interrupt-write-failed');
    const base = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({ streamer: { ...base, completed: 7 } });
    const interruptRun = vi
      .spyOn(repo, 'interruptRun')
      .mockResolvedValue({ ok: false, error: 'storage-unavailable' });

    useLaserStore.setState({ streamer: null });
    await vi.waitFor(() => expect(interruptRun).toHaveBeenCalledOnce());
    expect(reportFailure).toHaveBeenCalledWith({ ok: false, error: 'storage-unavailable' });
    expect(useLaserStore.getState().activeRunId).toBe('run-interrupt-write-failed');
  });

  it('retries clean completion on a later null-stream update without duplicating success', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-complete-retry');
    const base = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({
      streamer: { ...base, completed: 60, status: 'done' },
      controllerOperation: {
        kind: 'post-job-settle',
        phase: 'awaiting-idle',
        idleReports: 2,
      },
    });
    const originalCompleteRun = repo.completeRun.bind(repo);
    const failureResult = { ok: false, error: 'storage-unavailable' } as const;
    let failed = false;
    const completeRun = vi.spyOn(repo, 'completeRun').mockImplementation(async (...args) => {
      if (!failed) {
        failed = true;
        return failureResult;
      }
      return originalCompleteRun(...args);
    });

    useLaserStore.setState({ streamer: null, controllerOperation: null });
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failureResult));
    expect(useLaserStore.getState().activeRunId).toBe('run-complete-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    useLaserStore.setState({ statusReport: { ...IDLE_STATUS } });

    await vi.waitFor(() =>
      expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('run-complete-retry'),
    );
    expect(completeRun).toHaveBeenCalledTimes(2);
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('retries disappearance interruption on a later null-stream update without duplicating success', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await startTrackedRun(repo, 'run-disappearance-retry');
    const base = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({ streamer: { ...base, completed: 7 } });
    const originalInterruptRun = repo.interruptRun.bind(repo);
    const failureResult = { ok: false, error: 'storage-unavailable' } as const;
    let failed = false;
    const interruptRun = vi.spyOn(repo, 'interruptRun').mockImplementation(async (...args) => {
      if (!failed) {
        failed = true;
        return failureResult;
      }
      return originalInterruptRun(...args);
    });

    useLaserStore.setState({ streamer: null });
    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failureResult));
    expect(useLaserStore.getState().activeRunId).toBe('run-disappearance-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    useLaserStore.setState({ statusReport: { ...IDLE_STATUS } });

    await vi.waitFor(() =>
      expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('run-disappearance-retry'),
    );
    expect(interruptRun).toHaveBeenCalledTimes(2);
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('treats disappearance before settled done as an interruption and clears stale ownership', async () => {
    const repo = repository();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo);
    await startTrackedRun(repo, 'run-lost');
    const base = useLaserStore.getState().streamer as StreamerState;
    useLaserStore.setState({ streamer: { ...base, completed: 7 } });
    useLaserStore.setState({ streamer: null });

    await vi.waitFor(() => expect(repo.getSnapshot().recoveryCapsule?.runId).toBe('run-lost'));
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });
});
