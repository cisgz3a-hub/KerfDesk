// Rolling audit 2026-10-21, 05-P3-1: a Start without a run id (an external
// G-code file, the camera target) left the previous job's recovery card, its
// Run again receipt and its second-pass offer in place, although the machine
// had since run something else. An accepted untracked Start now retires them,
// as the manual restart always did; a refusal before any program write keeps
// them.

import { afterEach, describe, expect, it } from 'vitest';
import { JobStartTransmissionError } from '../state/laser-start-transmission-error';
import {
  clearUnarchivedRun,
  completeUnarchivedRun,
  rememberUnarchivedRun,
  useUnarchivedRunStore,
} from '../state/laser-unarchived-run';
import { RecoveryRepository } from '../state/recovery';
import {
  createCurrentTestExecutionArtifact,
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { startUntrackedRun } from './untracked-start-retirement';

const NOW = '2026-10-21T12:00:00.000Z';

afterEach(() => clearUnarchivedRun());

async function repositoryWith(ending: 'completed' | 'interrupted'): Promise<RecoveryRepository> {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
  expect((await repository.initialize()).ok).toBe(true);
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'project-job',
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
  const ended =
    ending === 'completed'
      ? await repository.completeRun(artifact.runId, NOW)
      : await repository.interruptRun(artifact.runId, 2, { kind: 'disconnect', message: 'Cable.' });
  expect(ended).toEqual({ ok: true, value: true });
  return repository;
}

/** An oversized job kept in memory for its second pass (ADR-341 Amendment 7). */
function keepUnarchivedCompletion(): void {
  rememberUnarchivedRun('oversized-job', async () => {
    throw new Error('Not opened in this test.');
  });
  expect(completeUnarchivedRun('oversized-job')).toBe(true);
}

describe('an untracked Start retires the previous job’s offers (05-P3-1)', () => {
  it('retires the Run again receipt and the second-pass offers once Start returns', async () => {
    const repository = await repositoryWith('completed');
    keepUnarchivedCompletion();
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('project-job');

    await startUntrackedRun(async () => undefined, repository);

    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(useUnarchivedRunStore.getState().completedRun).toBeNull();
  });

  it('retires the interrupted job’s recovery card once Start returns', async () => {
    const repository = await repositoryWith('interrupted');
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('project-job');

    await startUntrackedRun(async () => undefined, repository);

    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('retires them when a program write was attempted, and rethrows', async () => {
    const repository = await repositoryWith('interrupted');
    const failure = new JobStartTransmissionError(new Error('Port closed.'), null, 0);

    await expect(startUntrackedRun(async () => Promise.reject(failure), repository)).rejects.toBe(
      failure,
    );

    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('keeps them when Start refused before writing any program', async () => {
    const repository = await repositoryWith('completed');
    keepUnarchivedCompletion();

    await expect(
      startUntrackedRun(
        async () => Promise.reject(new Error('Frame the program first.')),
        repository,
      ),
    ).rejects.toThrow('Frame the program first.');

    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('project-job');
    expect(useUnarchivedRunStore.getState().completedRun?.runId).toBe('oversized-job');
  });
});
