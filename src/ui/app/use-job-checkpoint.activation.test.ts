import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  onAck,
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

function streamerAfterAcks(count: number): StreamerState {
  let streamer = baseStreamer();
  for (let index = 0; index < count; index += 1) {
    streamer = step(onAck(streamer, 'ok').state).state;
  }
  return streamer;
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

describe('checkpoint progress during accepted-run activation', () => {
  it('keeps a pre-activation no-op quiet and persists the latest owned progress after activation', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await repo.stageArtifact(await executionArtifact('run-activation'));
    await repo.armFreshStart('run-activation', NOW);
    const updateProgress = vi.spyOn(repo, 'updateProgress');
    const observed = streamerAfterAcks(13);
    useLaserStore.setState({
      activeRunId: 'run-activation',
      streamer: observed,
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateProgress).not.toHaveBeenCalled();
    expect(repo.getSnapshot().pendingStart?.runId).toBe('run-activation');
    expect(repo.getSnapshot().activeRun).toBeNull();
    expect(reportFailure).not.toHaveBeenCalled();

    expect(observed.completed).toBe(13);
    expect(observed.status).toBe('streaming');
    await repo.activateFreshRun('run-activation', NOW);
    // No later controller event is needed to persist these actual ACK/refill
    // transitions. Activation only updates storage; it does not replay work.
    await waitForAck(repo, 13);
    expect(updateProgress.mock.calls.map(([, ackedLines]) => ackedLines)).toEqual([13]);
    expect(useLaserStore.getState().activeRunId).toBe('run-activation');
    expect(useLaserStore.getState().streamer).toBe(observed);
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(repo.getSnapshot().recoveryCapsule).toBeNull();
    expect(reportFailure).not.toHaveBeenCalled();

    // The benign no-op must not consume the once-only real failure reporter.
    updateProgress.mockResolvedValueOnce({ ok: false, error: 'storage-unavailable' });
    useLaserStore.setState({ streamer: streamerAfterAcks(38) });
    await vi.waitFor(() =>
      expect(reportFailure).toHaveBeenCalledWith({ ok: false, error: 'storage-unavailable' }),
    );
  });

  it('does not apply another live owner acknowledgement count when an older archive activates', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await repo.stageArtifact(await executionArtifact('older-archive'));
    await repo.armFreshStart('older-archive', NOW);
    const updateProgress = vi.spyOn(repo, 'updateProgress');
    const otherRun = streamerAfterAcks(13);
    useLaserStore.setState({
      activeRunId: 'other-live-run',
      streamer: otherRun,
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
    });

    // Drain the unrelated live run's initial observation before checking the
    // activation callback. Its prior writes cannot be attributed to activation.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const priorWrites = [...updateProgress.mock.calls];
    const priorFailures = [...reportFailure.mock.calls];
    await repo.activateFreshRun('older-archive', NOW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repo.getSnapshot().activeRun).toMatchObject({ runId: 'older-archive', ackedLines: 0 });
    expect(updateProgress.mock.calls).toEqual(priorWrites);
    expect(reportFailure.mock.calls).toEqual(priorFailures);
    expect(useLaserStore.getState().activeRunId).toBe('other-live-run');
    expect(useLaserStore.getState().streamer).toBe(otherRun);
    expect(repo.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(repo.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('defers clean terminal persistence through activation without a false storage warning', async () => {
    const repo = repository();
    const reportFailure = vi.fn();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => LATER, repo, reportFailure);
    await repo.stageArtifact(await executionArtifact('run-tiny-activation'));
    await repo.armFreshStart('run-tiny-activation', NOW);
    useLaserStore.setState({
      activeRunId: 'run-tiny-activation',
      streamer: { ...baseStreamer(), completed: 60, status: 'done' },
      connection: { kind: 'connected' },
      statusReport: IDLE_STATUS,
      controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 2 },
    });
    useLaserStore.setState({ streamer: null, controllerOperation: null });
    await vi.waitFor(() => expect(useLaserStore.getState().activeRunId).toBeNull());
    expect(reportFailure).not.toHaveBeenCalled();
    await repo.activateFreshRun('run-tiny-activation', NOW);
    await vi.waitFor(() =>
      expect(repo.getSnapshot().lastCompletedReceipt?.runId).toBe('run-tiny-activation'),
    );
    expect(reportFailure).not.toHaveBeenCalled();
  });
});
