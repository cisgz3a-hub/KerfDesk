import { describe, expect, it, vi } from 'vitest';
import type { ExecutionArtifactV1 } from './execution-artifact';
import type { LegacyCheckpointStorage } from './legacy-checkpoint-migration';
import { cleanupDisplacedRecoveryArtifacts } from './recovery-artifact-cleanup';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import {
  CURRENT_EXECUTION_ARTIFACT_ORIGIN,
  emptyRecoverySlots,
  type RecoveryRepositoryResult,
} from './recovery-model';
import { RecoveryRepository } from './recovery-repository';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-07-19T03:00:00.000Z';
const LEGACY_STORAGE: LegacyCheckpointStorage = { read: () => null, clear: () => undefined };

function repository(
  backend: MemoryRecoveryStorageBackend,
  generationStore: MemoryRecoveryGenerationStore,
): RecoveryRepository {
  return new RecoveryRepository({
    backend,
    generationStore,
    legacyStorage: LEGACY_STORAGE,
    nowIso: () => NOW,
  });
}

function expectTrue(result: RecoveryRepositoryResult<boolean>): void {
  expect(result).toEqual({ ok: true, value: true });
}

describe('recovery staging races', () => {
  it('defers a terminal whose first persistence attempt fails before activation', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const owner = repository(backend, new MemoryRecoveryGenerationStore());
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-terminal-retry' });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);
    backend.failNext('mutate-slots');

    expectTrue(await owner.completeRun(artifact.runId, NOW));
    expectTrue(await owner.activateFreshRun(artifact.runId, NOW));

    expect(owner.getSnapshot().activeRun).toBeNull();
    expect(owner.getSnapshot().lastCompletedReceipt?.runId).toBe(artifact.runId);
  });

  it('shares a first terminal no-op that commits before activation', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const owner = repository(backend, new MemoryRecoveryGenerationStore());
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-terminal-interleave' });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);
    const mutateSlots = backend.mutateSlots.bind(backend);
    const firstPersistStarted = deferred();
    const firstPersistReleased = deferred();
    vi.spyOn(backend, 'mutateSlots').mockImplementationOnce(async (mutate) => {
      const value = await mutateSlots(mutate);
      firstPersistStarted.resolve();
      await firstPersistReleased.promise;
      return value;
    });
    const activationCommitted = deferred();
    const mutateSlotsWithArtifact = backend.mutateSlotsWithArtifact.bind(backend);
    vi.spyOn(backend, 'mutateSlotsWithArtifact').mockImplementationOnce(async (runId, mutate) => {
      const value = await mutateSlotsWithArtifact(runId, mutate);
      activationCommitted.resolve();
      return value;
    });

    const terminal = owner.completeRun(artifact.runId, NOW);
    await firstPersistStarted.promise;
    let activationSettled = false;
    const activation = owner.activateFreshRun(artifact.runId, NOW).then((result) => {
      activationSettled = true;
      return result;
    });
    await activationCommitted.promise;
    expect(activationSettled).toBe(false);
    firstPersistReleased.resolve();

    expectTrue(await activation);
    expectTrue(await terminal);
    expect(owner.getSnapshot().lastCompletedReceipt?.runId).toBe(artifact.runId);
  });

  it('shares a terminal attempt that commits after activation', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const owner = repository(backend, new MemoryRecoveryGenerationStore());
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'run-terminal-activation-first',
    });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);
    const mutateSlots = backend.mutateSlots.bind(backend);
    const firstPersistStarted = deferred();
    const releaseFirstPersist = deferred();
    vi.spyOn(backend, 'mutateSlots').mockImplementationOnce(async (mutate) => {
      firstPersistStarted.resolve();
      await releaseFirstPersist.promise;
      return mutateSlots(mutate);
    });
    const activationCommitted = deferred();
    const mutateSlotsWithArtifact = backend.mutateSlotsWithArtifact.bind(backend);
    vi.spyOn(backend, 'mutateSlotsWithArtifact').mockImplementationOnce(async (runId, mutate) => {
      const value = await mutateSlotsWithArtifact(runId, mutate);
      activationCommitted.resolve();
      return value;
    });

    const terminal = owner.completeRun(artifact.runId, NOW);
    await firstPersistStarted.promise;
    let activationSettled = false;
    const activation = owner.activateFreshRun(artifact.runId, NOW).then((result) => {
      activationSettled = true;
      return result;
    });
    await activationCommitted.promise;
    expect(activationSettled).toBe(false);
    releaseFirstPersist.resolve();

    expectTrue(await activation);
    expectTrue(await terminal);
    expect(owner.getSnapshot().lastCompletedReceipt?.runId).toBe(artifact.runId);
  });

  it("preserves another repository's durably leased staged artifact during startup cleanup", async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const generationStore = new MemoryRecoveryGenerationStore();
    const owner = repository(backend, generationStore);
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-cross-tab-stage' });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);

    const sweeper = repository(backend, generationStore);
    expect((await sweeper.initialize()).ok).toBe(true);
    expect(await backend.artifactExists(artifact.runId)).toBe(true);

    expectTrue(await owner.armFreshStart(artifact.runId, NOW));
    expectTrue(await owner.activateFreshRun(artifact.runId, NOW));
    expect(await backend.artifactExists(artifact.runId)).toBe(true);
  });

  it("does not let a stale owner's direct discard delete another repository's pending Start", async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const generationStore = new MemoryRecoveryGenerationStore();
    const staleOwner = repository(backend, generationStore);
    const liveOwner = repository(backend, generationStore);
    await staleOwner.initialize();
    await liveOwner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-stale-discard' });
    expect((await staleOwner.stageArtifact(artifact)).ok).toBe(true);

    expectTrue(await liveOwner.armFreshStart(artifact.runId, NOW));
    expect(staleOwner.getSnapshot().pendingStart).toBeNull();
    expect(await staleOwner.discardStagedRun(artifact.runId)).toEqual({ ok: true, value: false });
    expect(await backend.artifactExists(artifact.runId)).toBe(true);
  });

  it('does not let displaced cleanup delete a run referenced by live shared slots', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const generationStore = new MemoryRecoveryGenerationStore();
    const staleOwner = repository(backend, generationStore);
    const liveOwner = repository(backend, generationStore);
    await staleOwner.initialize();
    await liveOwner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-stale-cleanup' });
    expect((await staleOwner.stageArtifact(artifact)).ok).toBe(true);
    expectTrue(await liveOwner.armFreshStart(artifact.runId, NOW));
    expect((await staleOwner.refresh()).ok).toBe(true);
    const before = staleOwner.getSnapshot();
    const after = { ...before, pendingStart: null };
    const onFailure = vi.fn();

    expect(
      await cleanupDisplacedRecoveryArtifacts({
        backend,
        before,
        after,
        isStaged: () => false,
        onFailure,
      }),
    ).toEqual(new Set());
    expect(onFailure).not.toHaveBeenCalled();
    expect(await backend.artifactExists(artifact.runId)).toBe(true);
  });

  it('refuses to arm cached staging when its durable artifact is missing', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const owner = repository(backend, new MemoryRecoveryGenerationStore());
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-missing-staging' });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);
    await backend.deleteArtifact(artifact.runId);

    expect(await owner.armFreshStart(artifact.runId, NOW)).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(owner.getSnapshot().pendingStart).toBeNull();
  });

  it('retains live pending slots during stale cleanup and closes the existence-check race', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const owner = repository(backend, new MemoryRecoveryGenerationStore());
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-atomic-retention' });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);
    expectTrue(await owner.armFreshStart(artifact.runId, NOW));

    await backend.deleteArtifactsExcept(new Set(), {
      generation: 0,
    });
    expect(await backend.artifactExists(artifact.runId)).toBe(true);

    const second = await createCurrentTestExecutionArtifact({ runId: 'run-atomic-arm' });
    expect((await owner.stageArtifact(second)).ok).toBe(true);
    const artifactExists = backend.artifactExists.bind(backend);
    vi.spyOn(backend, 'artifactExists').mockImplementationOnce(async (runId) => {
      const exists = await artifactExists(runId);
      await backend.deleteArtifact(runId);
      return exists;
    });
    expect(await owner.armFreshStart(second.runId, NOW)).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('drops a rejected legacy active owner so a new Start can arm', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const generationStore = new MemoryRecoveryGenerationStore();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-rejected-legacy' });
    const { provenance: _provenance, estimatedArtifactBytes: _estimate, ...base } = current;
    const legacy = { ...base, schemaVersion: 1 } as ExecutionArtifactV1;
    await backend.putArtifact({
      runId: legacy.runId,
      generation: 0,
      origin: CURRENT_EXECUTION_ARTIFACT_ORIGIN,
      artifact: legacy,
    });
    await backend.mutateSlots(() => ({
      slots: {
        ...emptyRecoverySlots(0),
        revision: 1,
        activeRun: {
          runId: legacy.runId,
          ackedLines: 0,
          sendableLines: legacy.sendableLines,
          startedAtIso: NOW,
          updatedAtIso: NOW,
        },
      },
      value: undefined,
    }));
    const owner = repository(backend, generationStore);

    expect((await owner.initialize()).ok).toBe(true);
    expect(owner.getSnapshot().activeRun).toBeNull();
    const fresh = await createCurrentTestExecutionArtifact({ runId: 'run-after-rejected-legacy' });
    expect((await owner.stageArtifact(fresh)).ok).toBe(true);
    expectTrue(await owner.armFreshStart(fresh.runId, NOW));
  });

  it('deletes an unreferenced artifact after accepted-run activation falls back', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const owner = repository(backend, new MemoryRecoveryGenerationStore());
    await owner.initialize();
    const artifact = await createCurrentTestExecutionArtifact({ runId: 'run-activation-fallback' });
    expect((await owner.stageArtifact(artifact)).ok).toBe(true);
    backend.failNext('mutate-slots');

    expect(await owner.activateFreshRun(artifact.runId, NOW)).toEqual({
      ok: false,
      error: 'storage-unavailable',
    });
    expectTrue(await owner.noteUntrackedRunAccepted(artifact.runId));

    expect(await backend.artifactExists(artifact.runId)).toBe(false);
  });
});

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
