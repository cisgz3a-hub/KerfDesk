import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { clearUnarchivedRun, useUnarchivedRunStore } from '../state/laser-unarchived-run';
import { RecoveryRepository } from '../state/recovery';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { resetStore } from '../state/test-helpers';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

let uninstallReview = (): void => undefined;
let uninstallTracking = (): void => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  clearUnarchivedRun();
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  uninstallTracking();
  uninstallReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  clearUnarchivedRun();
  resetStore();
  vi.restoreAllMocks();
});

// A photo engraving over the archive budget, or one whose archive write
// failed, streams with no archive. Its clean finish on a real stream is still
// offered a second pass, from the copy this page keeps (ADR-341 Amendment 7).
describe('a Start the execution archive could not keep', () => {
  it('offers the second pass after the job settles, without a tracking failure', async () => {
    const simulator = createGrblSimulator();
    await useLaserStore.getState().connect(simulator.adapter);
    await vi.advanceTimersByTimeAsync(1_200);
    const backend = new MemoryRecoveryStorageBackend();
    const repository = new RecoveryRepository({
      backend,
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
    });
    await repository.initialize();
    const fixture = await createSecondPassExecutionFixture(repository);
    useStore.setState({ project: fixture.source.prepared.project });
    const reportFailure = vi.fn();
    const onCompleted = vi.fn();
    uninstallTracking = installJobCheckpointTracking(
      () => new Date().toISOString(),
      repository,
      reportFailure,
      onCompleted,
    );
    await installReviewPendingFramedRunPermitForCurrentState();
    backend.failNext('put-artifact');

    const running = runStartJobFlow(repository);
    await vi.waitFor(() => expect(useUnarchivedRunStore.getState().runId).not.toBeNull());
    const runId = useLaserStore.getState().activeRunId;
    expect(useUnarchivedRunStore.getState().runId).toBe(runId);
    expect(onCompleted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await running;

    await vi.waitFor(() => expect(onCompleted.mock.calls).toEqual([[runId]]));
    expect(useUnarchivedRunStore.getState().completedRun?.runId).toBe(runId);
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(reportFailure).not.toHaveBeenCalled();
    const artifact = await useUnarchivedRunStore.getState().completedRun?.openArtifact();
    if (artifact === undefined) throw new Error('Expected the kept artifact.');
    expect(artifact.runId).toBe(runId);
    expect(simulator.outbound().join('')).toContain(artifact.gcode.split('\n')[0]);
    await expect(executionArtifactIntegrityIsValid(artifact)).resolves.toBe(true);
  });
});
