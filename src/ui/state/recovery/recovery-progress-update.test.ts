import { describe, expect, it, vi } from 'vitest';
import type { LegacyCheckpointStorage } from './legacy-checkpoint-migration';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';
const LEGACY_STORAGE: LegacyCheckpointStorage = { read: () => null, clear: () => undefined };

function repositoryHarness(
  backend = new MemoryRecoveryStorageBackend(),
  generationStore = new MemoryRecoveryGenerationStore(),
): {
  readonly backend: MemoryRecoveryStorageBackend;
  readonly generationStore: MemoryRecoveryGenerationStore;
  readonly repository: RecoveryRepository;
} {
  return {
    backend,
    generationStore,
    repository: new RecoveryRepository({
      backend,
      generationStore,
      legacyStorage: LEGACY_STORAGE,
      nowIso: () => LATER,
    }),
  };
}

async function activate(repository: RecoveryRepository, runId: string): Promise<void> {
  const artifact = await createCurrentTestExecutionArtifact({ runId, createdAtIso: NOW });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(runId, NOW)).ok).toBe(true);
}

describe('recovery progress fast path', () => {
  it('commits progress without re-reading, hydrating, or cleaning artifact storage', async () => {
    const { backend, repository } = repositoryHarness();
    await activate(repository, 'run-fast-progress');
    const before = repository.getSnapshot();
    const readSlots = vi.spyOn(backend, 'readSlots');
    const getArtifact = vi.spyOn(backend, 'getArtifact');
    const cleanupArtifacts = vi.spyOn(backend, 'deleteArtifactsExcept');
    const deleteArtifact = vi.spyOn(backend, 'deleteArtifact');
    const mutateSlots = vi.spyOn(backend, 'mutateSlots');

    expect((await repository.updateProgress('run-fast-progress', 2, LATER)).ok).toBe(true);

    const after = repository.getSnapshot();
    expect(after.activeRun?.ackedLines).toBe(2);
    expect(after.activeRun?.artifact).toBe(before.activeRun?.artifact);
    expect(after.executionHistory).toBe(before.executionHistory);
    expect(mutateSlots).toHaveBeenCalledTimes(1);
    expect(readSlots).not.toHaveBeenCalled();
    expect(getArtifact).not.toHaveBeenCalled();
    expect(cleanupArtifacts).not.toHaveBeenCalled();
    expect(deleteArtifact).not.toHaveBeenCalled();
  });

  it('refreshes cross-window slots while reusing the unchanged verified artifact', async () => {
    const first = repositoryHarness();
    await activate(first.repository, 'run-shared-progress');
    const staleArtifact = first.repository.getSnapshot().activeRun?.artifact;
    const second = repositoryHarness(first.backend, first.generationStore);
    await second.repository.refresh();
    await second.repository.updateProgress('run-shared-progress', 1, LATER);
    const readSlots = vi.spyOn(first.backend, 'readSlots');
    const getArtifact = vi.spyOn(first.backend, 'getArtifact');
    const mutateSlots = vi.spyOn(first.backend, 'mutateSlots');

    expect((await first.repository.updateProgress('run-shared-progress', 2, LATER)).ok).toBe(true);

    expect(first.repository.getSnapshot().activeRun?.ackedLines).toBe(2);
    expect(first.repository.getSnapshot().activeRun?.artifact).toBe(staleArtifact);
    expect(mutateSlots).toHaveBeenCalledTimes(1);
    expect(readSlots).toHaveBeenCalledTimes(1);
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('does not let a slow older refresh overwrite a newer progress publication', async () => {
    const { backend, repository } = repositoryHarness();
    await activate(repository, 'run-refresh-race');
    const originalGetArtifact = backend.getArtifact.bind(backend);
    let releaseArtifactRead = (): void => undefined;
    let noteArtifactRead = (): void => undefined;
    const artifactReadStarted = new Promise<void>((resolve) => {
      noteArtifactRead = resolve;
    });
    const artifactReadReleased = new Promise<void>((resolve) => {
      releaseArtifactRead = resolve;
    });
    vi.spyOn(backend, 'getArtifact').mockImplementation(async (runId) => {
      noteArtifactRead();
      await artifactReadReleased;
      return originalGetArtifact(runId);
    });

    const staleRefresh = repository.refresh();
    await artifactReadStarted;
    expect((await repository.updateProgress('run-refresh-race', 2, LATER)).ok).toBe(true);
    const currentArtifact = repository.getSnapshot().activeRun?.artifact;
    releaseArtifactRead();
    expect((await staleRefresh).ok).toBe(true);

    expect(repository.getSnapshot().activeRun?.ackedLines).toBe(2);
    expect(repository.getSnapshot().activeRun?.artifact).toBe(currentArtifact);
  });

  it('honors a newer cross-window Forget marker written as the progress transaction commits', async () => {
    const { backend, generationStore, repository } = repositoryHarness();
    await activate(repository, 'run-forget-race');
    const mutateSlots = backend.mutateSlots.bind(backend);
    vi.spyOn(backend, 'mutateSlots').mockImplementation(async (mutate) => {
      const result = await mutateSlots(mutate);
      generationStore.write(1);
      return result;
    });

    expect((await repository.updateProgress('run-forget-race', 2, LATER)).ok).toBe(true);

    expect(repository.getSnapshot()).toMatchObject({
      generation: 1,
      activeRun: null,
      recoveryCapsule: null,
      lastCompletedReceipt: null,
    });
  });

  it('fails closed when a progress mutation repairs corrupt persisted slots', async () => {
    const { backend, repository } = repositoryHarness();
    await activate(repository, 'run-corrupt-progress');
    await backend.mutateSlots(() => ({
      slots: { schemaVersion: 999 } as never,
      value: undefined,
    }));

    expect((await repository.updateProgress('run-corrupt-progress', 2, LATER)).ok).toBe(true);

    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });
});
