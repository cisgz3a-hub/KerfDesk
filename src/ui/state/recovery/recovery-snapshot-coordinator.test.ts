import { describe, expect, it, vi } from 'vitest';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-07-19T03:00:00.000Z';

function harness() {
  const backend = new MemoryRecoveryStorageBackend();
  return {
    backend,
    repository: new RecoveryRepository({
      backend,
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => NOW,
    }),
  };
}

describe('recovery snapshot coordination', () => {
  it('activates a staged accepted run without cloning or rehashing its artifact', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-fast-activation' });
    expect((await repository.stageArtifact(artifact)).ok).toBe(true);
    expect((await repository.armFreshStart(artifact.runId, NOW)).ok).toBe(true);
    const getArtifact = vi.spyOn(backend, 'getArtifact');

    expect((await repository.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);

    expect(getArtifact).not.toHaveBeenCalled();
    expect(repository.getSnapshot().activeRun?.artifact).toBe(artifact);
  });

  it('accepts an authoritative empty reset when persisted slots become corrupt', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-corrupt-reset' });
    await repository.stageArtifact(artifact);
    await repository.activateFreshRun(artifact.runId, NOW);
    await repository.updateProgress(artifact.runId, 2, NOW);
    expect(repository.getSnapshot().activeRun?.runId).toBe(artifact.runId);
    await backend.mutateSlots(() => ({
      slots: { schemaVersion: 999 } as never,
      value: undefined,
    }));

    expect((await repository.refresh()).ok).toBe(true);

    expect(repository.getSnapshot()).toMatchObject({
      loaded: true,
      activeRun: null,
      recoveryCapsule: null,
      lastCompletedReceipt: null,
      executionHistory: [],
    });
  });
});
