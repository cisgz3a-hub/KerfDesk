import { describe, expect, it, vi } from 'vitest';
import { RecoveryRepository } from './recovery-repository';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { createCurrentTestExecutionArtifact } from './testing';

function repository(backend: MemoryRecoveryStorageBackend) {
  return new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
}

describe('untracked acceptance ownership', () => {
  it('does not clear another window run when fallback storage is delayed', async () => {
    const backend = new MemoryRecoveryStorageBackend();
    const first = repository(backend);
    await first.initialize();
    const old = await createCurrentTestExecutionArtifact({ runId: 'old-activation-failure' });
    await first.stageArtifact(old);
    await first.activateFreshRun(old.runId);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = vi.fn();
    const mutate = backend.mutateSlots.bind(backend);
    vi.spyOn(backend, 'mutateSlots').mockImplementationOnce(async (mutation) => {
      reached();
      await gate;
      return mutate(mutation);
    });
    const fallback = first.noteUntrackedRunAccepted(old.runId, undefined, { current: () => true });
    await vi.waitFor(() => expect(reached).toHaveBeenCalled());
    const second = repository(backend);
    await second.initialize();
    const later = await createCurrentTestExecutionArtifact({ runId: 'later-other-window' });
    await second.stageArtifact(later);
    await second.activateFreshRun(later.runId);
    release();
    expect(await fallback).toEqual({ ok: true, value: false });
    expect(first.getSnapshot().activeRun?.runId).toBe(later.runId);
    expect((await second.refresh()).ok).toBe(true);
    expect(second.getSnapshot().activeRun?.runId).toBe(later.runId);
    vi.restoreAllMocks();
  });
});
