import { describe, expect, it } from 'vitest';
import type { ExecutionArtifactV1 } from './execution-artifact';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from './execution-artifact-size';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { emptyRecoverySlots, MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN } from './recovery-model';
import { RecoveryRepository } from './recovery-repository';
import { hydrateRecoveryState } from './recovery-snapshot';
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

describe('recovery artifact store trust boundaries', () => {
  it('rejects a forged schema-v1 downgrade even when its mutable origin claims migration', async () => {
    const { backend, repository } = harness();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-forged-downgrade' });
    const forged = { ...current, schemaVersion: 1 } as ExecutionArtifactV1;
    await backend.putArtifact({
      runId: forged.runId,
      generation: 0,
      origin: MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
      artifact: forged,
    });
    await backend.mutateSlots(() => ({
      slots: {
        ...emptyRecoverySlots(0),
        recoveryCapsule: {
          runId: forged.runId,
          artifactKind: 'exact-execution',
          revision: 1,
          ackedLines: 0,
          sendableLines: forged.sendableLines,
          interruption: { kind: 'disconnect', message: 'Cable removed.' },
          updatedAtIso: NOW,
        },
      },
      value: undefined,
    }));

    const initialized = await repository.initialize();

    expect(initialized.ok).toBe(true);
    if (!initialized.ok) throw new Error(`Initialization failed: ${initialized.error}`);
    expect(initialized.value.recoveryCapsule).toBeNull();
    const forgedKnownState = await hydrateRecoveryState(
      backend,
      {
        ...emptyRecoverySlots(0),
        recoveryCapsule: {
          runId: forged.runId,
          artifactKind: 'exact-execution',
          revision: 1,
          ackedLines: 0,
          sendableLines: forged.sendableLines,
          interruption: { kind: 'disconnect', message: 'Cable removed.' },
          updatedAtIso: NOW,
        },
      },
      new Map([[forged.runId, forged]]),
    );
    expect(forgedKnownState.snapshot.recoveryCapsule).toBeNull();
    await expect(repository.getArchivedExecution(forged.runId)).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('recomputes the whole-artifact cap instead of trusting its stored estimate', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-oversized-nested' });
    const oversized = {
      ...current,
      estimatedArtifactBytes: 1,
      untrustedNestedField: {
        nested: {
          payload: 'x'.repeat(Math.floor(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES / 3) + 1),
        },
      },
    } as ExecutionArtifactV1;

    await expect(repository.stageArtifact(oversized)).resolves.toEqual({
      ok: false,
      error: 'conflict',
    });
    expect(await backend.getArtifact(oversized.runId)).toBeNull();
  });

  it('charges a typed-array view for its complete oversized backing buffer', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-oversized-backing' });
    const backing = new ArrayBuffer(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES + 16 * 1024 * 1024);
    const oversized = {
      ...current,
      estimatedArtifactBytes: 1,
      untrustedNestedField: { oneByteView: new Uint8Array(backing, 0, 1) },
    } as ExecutionArtifactV1;

    await expect(repository.stageArtifact(oversized)).resolves.toEqual({
      ok: false,
      error: 'conflict',
    });
    expect(await backend.artifactExists(oversized.runId)).toBe(false);
  });

  it('counts a backing buffer once when multiple views share it', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-shared-backing' });
    const backing = new ArrayBuffer(20 * 1024 * 1024);
    const shared = {
      ...current,
      estimatedArtifactBytes: 1,
      untrustedNestedField: {
        first: new Uint8Array(backing, 0, 1),
        second: new Uint8Array(backing, backing.byteLength - 1, 1),
      },
    } as ExecutionArtifactV1;

    await expect(repository.stageArtifact(shared)).resolves.toEqual({
      ok: true,
      value: shared.runId,
    });
    expect(await backend.artifactExists(shared.runId)).toBe(true);
  });

  it('supports small structured-clone Set, Map, and Blob containers', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-small-containers' });
    const supported = {
      ...current,
      estimatedArtifactBytes: 1,
      untrustedNestedField: {
        selected: new Set(['object-a', 'object-b']),
        lookup: new Map([['object-a', { index: 1 }]]),
        attachment: new Blob(['small payload'], { type: 'text/plain' }),
      },
    } as ExecutionArtifactV1;

    await expect(repository.stageArtifact(supported)).resolves.toEqual({
      ok: true,
      value: supported.runId,
    });
    expect(await backend.artifactExists(supported.runId)).toBe(true);
  });

  it('counts nested Map payload bytes instead of trusting its entry count', async () => {
    const { backend, repository } = harness();
    await repository.initialize();
    const current = await createCurrentTestExecutionArtifact({ runId: 'run-oversized-map' });
    const oversized = {
      ...current,
      estimatedArtifactBytes: 1,
      untrustedNestedField: new Map([
        ['hidden', 'x'.repeat(Math.floor(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES / 3) + 1)],
      ]),
    } as ExecutionArtifactV1;

    await expect(repository.stageArtifact(oversized)).resolves.toEqual({
      ok: false,
      error: 'conflict',
    });
    expect(await backend.artifactExists(oversized.runId)).toBe(false);
  });
});
