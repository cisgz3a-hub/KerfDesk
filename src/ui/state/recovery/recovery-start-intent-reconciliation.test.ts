import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { IndexedDbRecoveryStorageBackend } from './indexeddb-recovery-backend';
import { MemoryRecoveryStorageBackend, type RecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { LEGACY_CHECKPOINT_ARTIFACT_ORIGIN } from './recovery-model';
import { RecoveryRepository } from './recovery-repository';
import { createStartIntent, startIntentStandInArtifact } from './start-intent';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-09-21T09:00:00.000Z';
const LATER = '2026-09-21T09:01:00.000Z';
const GCODE = 'G21\nG90\nG1 X1\nM5\n';

function harness(backend: RecoveryStorageBackend) {
  const generationStore = new MemoryRecoveryGenerationStore();
  const open = () =>
    new RecoveryRepository({
      backend,
      generationStore,
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => LATER,
    });
  return { repository: open(), open, backend };
}

function intent() {
  return createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
}

function artifact(runId: string, gcode = GCODE) {
  return createCurrentTestExecutionArtifact({ runId, gcode, createdAtIso: NOW });
}

describe.each([
  ['memory', () => new MemoryRecoveryStorageBackend()],
  ['IndexedDB', () => new IndexedDbRecoveryStorageBackend(new IDBFactory())],
] as const)('interrupted Start intent reconciliation (%s)', (_name, makeBackend) => {
  it.each(['absent', 'stand-in', 'exact'] as const)(
    'recovers with an %s archive and allows another ordinary Start',
    async (archiveState) => {
      const { repository, open, backend } = harness(makeBackend());
      await repository.initialize();
      await repository.armFreshStartIntent('interrupted', intent(), NOW);
      if (archiveState === 'exact') {
        await repository.stageArtifact(await artifact('interrupted'));
      } else if (archiveState === 'stand-in') {
        // A second crash after the stand-in commits but before its capsule.
        await backend.putArtifact({
          runId: 'interrupted',
          generation: 0,
          origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
          artifact: startIntentStandInArtifact('interrupted', intent(), NOW),
        });
      }
      const storedBefore = await backend.getArtifact('interrupted');
      const reopened = open();
      expect((await reopened.initialize()).ok).toBe(true);
      expect(reopened.getSnapshot().pendingStart).toBeNull();
      const expectedKind = archiveState === 'exact' ? 'exact-execution' : 'legacy-fingerprint-only';
      expect(reopened.getSnapshot().recoveryCapsule).toMatchObject({
        runId: 'interrupted',
        artifactKind: expectedKind,
        artifact: { kind: expectedKind, fingerprint: intent().fingerprint },
        interruption: { message: expect.stringContaining('Motion may or may not have begun') },
      });
      if (storedBefore !== null) {
        expect(await backend.getArtifact('interrupted')).toEqual(storedBefore);
      }
      const again = open();
      await again.initialize();
      expect(again.getSnapshot().recoveryCapsule?.artifact.kind).toBe(expectedKind);
      expect(await again.armFreshStartIntent('next-start', intent(), LATER)).toEqual({
        ok: true,
        value: true,
      });
    },
  );

  it('does not associate an existing archive for a different program with the intent', async () => {
    const { repository, open } = harness(makeBackend());
    await repository.initialize();
    await repository.armFreshStartIntent('wrong-program', intent(), NOW);
    await repository.stageArtifact(await artifact('wrong-program', GCODE.replace('X1', 'X2')));
    const reopened = open();
    await reopened.initialize();
    expect(reopened.getSnapshot().pendingStart?.runId).toBe('wrong-program');
    expect(reopened.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('does not trust an exact archive whose integrity check fails', async () => {
    const { repository, open, backend } = harness(makeBackend());
    await repository.initialize();
    await repository.armFreshStartIntent('damaged', intent(), NOW);
    const exact = await artifact('damaged');
    if (exact.provenance === undefined)
      throw new Error('Expected an exact archive with provenance');
    await backend.putArtifact({
      runId: exact.runId,
      generation: 0,
      origin: 'current-v2',
      artifact: {
        ...exact,
        provenance: {
          ...exact.provenance,
          content: { ...exact.provenance.content, gcodeSha256: `sha256:${'0'.repeat(64)}` },
        },
      },
    });
    const reopened = open();
    await reopened.initialize();
    expect(reopened.getSnapshot().pendingStart?.runId).toBe('damaged');
    expect(reopened.getSnapshot().recoveryCapsule).toBeNull();
  });

  it.each(['absent', 'exact'] as const)(
    'preserves a newer pending Start while reconciling an %s archive',
    async (archiveState) => {
      const { repository, open, backend } = harness(makeBackend());
      await repository.initialize();
      await repository.armFreshStartIntent('old-start', intent(), NOW);
      if (archiveState === 'exact') await repository.stageArtifact(await artifact('old-start'));
      const put = backend.putArtifact.bind(backend);
      const spy = vi.spyOn(backend, 'putArtifact').mockImplementationOnce(async (record) => {
        const inserted = await put(record);
        expect(await repository.cancelPendingStart('old-start')).toEqual({ ok: true, value: true });
        expect(await repository.armFreshStartIntent('new-start', intent(), LATER)).toEqual({
          ok: true,
          value: true,
        });
        return inserted;
      });
      const reopened = open();
      expect((await reopened.initialize()).ok).toBe(true);
      expect(reopened.getSnapshot().pendingStart?.runId).toBe('new-start');
      expect(reopened.getSnapshot().recoveryCapsule).toBeNull();
      spy.mockRestore();
    },
  );
});
