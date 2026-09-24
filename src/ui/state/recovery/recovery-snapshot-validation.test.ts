import { describe, expect, it, vi } from 'vitest';
import { fingerprintGcode } from '../../../core/recovery';
import type * as CoreRecovery from '../../../core/recovery';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

// Full artifact validation fingerprints the whole program text, which is the
// cost worth counting: a 200k-line job pays it per validation.
vi.mock('../../../core/recovery', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreRecovery>();
  return { ...actual, fingerprintGcode: vi.fn(actual.fingerprintGcode) };
});

const NOW = '2026-07-15T10:00:00.000Z';

describe('recovery snapshot artifact validation', () => {
  it('validates each retained artifact once, not again on every refresh', async () => {
    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => NOW,
    });
    await repository.initialize();
    for (const runId of ['run-archived', 'run-latest']) {
      await repository.stageArtifact(await createCurrentTestExecutionArtifact({ runId }));
      await repository.activateFreshRun(runId, NOW);
      await repository.completeRun(runId, NOW);
    }
    const fingerprint = vi.mocked(fingerprintGcode);
    fingerprint.mockClear();

    // Each mutation re-hydrates the snapshot from the artifacts it already
    // holds; none of them changed, so none is fingerprinted again.
    for (let refresh = 0; refresh < 3; refresh += 1) {
      expect((await repository.discardRecovery()).ok).toBe(true);
    }

    expect(fingerprint).not.toHaveBeenCalled();
    const snapshot = repository.getSnapshot();
    expect(snapshot.lastCompletedReceipt?.runId).toBe('run-latest');
    expect(snapshot.executionHistory.map((record) => record.runId)).toEqual([
      'run-archived',
      'run-latest',
    ]);
  });
});
