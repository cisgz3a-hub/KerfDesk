import { describe, expect, it, vi } from 'vitest';
import { createJobCheckpoint, serializeJobCheckpoint } from '../../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import {
  createExecutionArtifact,
  type ArchivedControllerObservationInput,
  type ExecutionArtifactV1,
  type RunId,
} from './execution-artifact';
import type { LegacyCheckpointStorage } from './legacy-checkpoint-migration';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';

type Harness = {
  readonly repository: RecoveryRepository;
  readonly backend: MemoryRecoveryStorageBackend;
  readonly generation: MemoryRecoveryGenerationStore;
  readonly legacy: { value: string | null };
};

function harness(options?: {
  readonly backend?: MemoryRecoveryStorageBackend;
  readonly generation?: MemoryRecoveryGenerationStore;
  readonly legacy?: { value: string | null };
}): Harness {
  const backend = options?.backend ?? new MemoryRecoveryStorageBackend();
  const generation = options?.generation ?? new MemoryRecoveryGenerationStore();
  const legacy = options?.legacy ?? { value: null };
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => legacy.value,
    clear: () => {
      legacy.value = null;
    },
  };
  return {
    backend,
    generation,
    legacy,
    repository: new RecoveryRepository({
      backend,
      generationStore: generation,
      legacyStorage,
      nowIso: () => LATER,
    }),
  };
}

function resultValue<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown },
): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected success, received ${String(result.error)}.`);
  return result.value;
}

function artifact(
  runId: RunId,
  gcode = 'G21\nG90\nG1 X1\nM5\n',
  observation?: ArchivedControllerObservationInput,
): ExecutionArtifactV1 {
  const project = {
    device: {
      controllerKind: 'grbl-v1.1',
      streamingMode: 'char-counted',
      rxBufferBytes: 120,
    },
  } as unknown as Project;
  const prepared = {
    ok: true,
    project,
    job: { groups: [] },
    jobOriginOffset: { x: 0, y: 0 },
  } as Extract<PreparedOutput, { readonly ok: true }>;
  const canvasPlan = {
    retentionKey: `signature-${runId}`,
  } as CanvasMotionPlan;
  return createExecutionArtifact({
    runId,
    gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan,
    controllerSettings: { maxPowerS: 1_000, laserModeEnabled: true },
    ...(observation === undefined ? {} : { controllerObservation: observation }),
    createdAtIso: NOW,
  });
}

async function activeThenInterrupted(repo: RecoveryRepository, runId: RunId): Promise<void> {
  expect((await repo.stageArtifact(artifact(runId))).ok).toBe(true);
  expect((await repo.activateFreshRun(runId, NOW)).ok).toBe(true);
  expect((await repo.updateProgress(runId, 2, LATER)).ok).toBe(true);
  expect(
    (await repo.interruptRun(runId, 2, { kind: 'disconnect', message: 'Cable removed.' }, LATER))
      .ok,
  ).toBe(true);
}

describe('RecoveryRepository', () => {
  it('round-trips exact multi-megabyte G-code without rewriting it on progress', async () => {
    const { repository } = harness();
    const largeGcode = `${'G1 X1 Y1\n'.repeat(600_000)}M5\n`;
    const exact = artifact('run-large', largeGcode);

    expect((await repository.stageArtifact(exact)).ok).toBe(true);
    expect((await repository.activateFreshRun(exact.runId, NOW)).ok).toBe(true);
    expect((await repository.updateProgress(exact.runId, 25, LATER)).ok).toBe(true);

    const active = repository.getSnapshot().activeRun;
    expect(active?.artifact.gcode.length).toBe(largeGcode.length);
    expect(active?.artifact.gcode.endsWith('M5\n')).toBe(true);
    expect(active?.ackedLines).toBe(25);
  });

  it('keeps staging sealed until accepted, then replaces the older capsule', async () => {
    const { repository } = harness();
    await activeThenInterrupted(repository, 'run-a');
    const previous = repository.getSnapshot().recoveryCapsule;

    expect((await repository.stageArtifact(artifact('run-b'))).ok).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule).toEqual(previous);
    expect((await repository.activateFreshRun('run-b', LATER)).ok).toBe(true);
    expect(repository.getSnapshot().activeRun?.runId).toBe('run-b');
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('settles a completed very-short run that finishes before activation', async () => {
    const { repository } = harness();
    await repository.stageArtifact(artifact('run-fast-complete'));

    expect(resultValue(await repository.completeRun('run-fast-complete', LATER))).toBe(true);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();

    expect(resultValue(await repository.activateFreshRun('run-fast-complete', NOW))).toBe(true);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('run-fast-complete');
  });

  it('settles an interrupted very-short run only after acceptance replaces the old capsule', async () => {
    const { repository, backend } = harness();
    await activeThenInterrupted(repository, 'run-old');
    await repository.stageArtifact(artifact('run-fast-interrupt'));

    expect(
      resultValue(
        await repository.interruptRun(
          'run-fast-interrupt',
          2,
          { kind: 'disconnect', message: 'Cable removed.' },
          LATER,
        ),
      ),
    ).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-old');

    await repository.activateFreshRun('run-fast-interrupt', NOW);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-fast-interrupt');
    expect(await backend.getArtifact('run-old')).toBeNull();
  });

  it('drops deferred settlement with a failed pre-acceptance staged run', async () => {
    const { repository, backend } = harness();
    await activeThenInterrupted(repository, 'run-old');
    await repository.stageArtifact(artifact('run-first-write-failed'));
    await repository.interruptRun(
      'run-first-write-failed',
      0,
      { kind: 'write-failed', message: 'The first write failed.' },
      LATER,
    );

    expect(resultValue(await repository.discardStagedRun('run-first-write-failed'))).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-old');
    expect(await backend.getArtifact('run-first-write-failed')).toBeNull();
  });

  it('keeps artifacts immutable when a runId is accidentally reused', async () => {
    const { repository } = harness();
    const original = artifact('run-fixed', 'G1 X1\n');
    expect((await repository.stageArtifact(original)).ok).toBe(true);
    expect((await repository.stageArtifact(original)).ok).toBe(true);

    expect(await repository.stageArtifact(artifact('run-fixed', 'G1 X9\n'))).toEqual({
      ok: false,
      error: 'conflict',
    });
    await repository.activateFreshRun('run-fixed', NOW);
    expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe('G1 X1\n');
  });

  it('preserves an older capsule on persistence failure and can supersede it nonblockingly', async () => {
    const { repository, backend } = harness();
    await activeThenInterrupted(repository, 'run-a');
    backend.failNext('put-artifact');

    expect(await repository.stageArtifact(artifact('run-b'))).toEqual({
      ok: false,
      error: 'storage-unavailable',
    });
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-a');
    expect((await repository.noteUntrackedRunAccepted()).ok).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('never lets equal-sized foreign runs advance or complete one another', async () => {
    const { repository } = harness();
    const sameSize = 'G1 X1\nG1 X2\n';
    await repository.stageArtifact(artifact('run-a', sameSize));
    await repository.stageArtifact(artifact('run-b', sameSize));
    await repository.activateFreshRun('run-a', NOW);

    expect(resultValue(await repository.updateProgress('run-b', 2, LATER))).toBe(false);
    expect(repository.getSnapshot().activeRun?.ackedLines).toBe(0);
    expect(resultValue(await repository.completeRun('run-b', LATER))).toBe(false);
    expect(repository.getSnapshot().activeRun?.runId).toBe('run-a');
  });

  it('moves only the owned active run to a replay receipt and discards it atomically', async () => {
    const { repository } = harness();
    await repository.stageArtifact(artifact('run-done'));
    await repository.activateFreshRun('run-done', NOW);
    expect(resultValue(await repository.completeRun('run-done', LATER))).toBe(true);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('run-done');

    expect(resultValue(await repository.discardCompletedReceipt('foreign'))).toBe(false);
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe('run-done');
    expect(resultValue(await repository.discardCompletedReceipt('run-done'))).toBe(true);
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  });

  it('claims by revision and attempt ID, returns the claimed revision, and releases retryably', async () => {
    const { repository, backend } = harness();
    await activeThenInterrupted(repository, 'run-a');
    const offered = repository.getSnapshot().recoveryCapsule;
    expect(offered).not.toBeNull();

    const claimed = await repository.claimRecovery({
      runId: 'run-a',
      revision: offered?.revision ?? -1,
      attemptId: 'attempt-1',
      claimedAtIso: LATER,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.revision).toBeGreaterThan(offered?.revision ?? 0);
    expect(claimed.value.claim?.attemptId).toBe('attempt-1');
    expect(
      await repository.claimRecovery({
        runId: 'run-a',
        revision: offered?.revision ?? -1,
        attemptId: 'attempt-2',
      }),
    ).toEqual({ ok: false, error: 'conflict' });

    backend.failNext('mutate-slots');
    expect(await repository.releaseRecoveryClaim('run-a', 'attempt-1', LATER)).toEqual({
      ok: false,
      error: 'storage-unavailable',
    });
    expect(repository.getSnapshot().recoveryCapsule?.claim?.attemptId).toBe('attempt-1');
    expect(resultValue(await repository.releaseRecoveryClaim('run-a', 'attempt-1', LATER))).toBe(
      true,
    );
    expect(repository.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
  });

  it('compensates a committed claim when post-commit hydration fails', async () => {
    const first = harness();
    await activeThenInterrupted(first.repository, 'run-claim-refresh-failure');
    const offered = first.repository.getSnapshot().recoveryCapsule;
    expect(offered).not.toBeNull();
    first.backend.failNext('get-artifact');

    expect(
      await first.repository.claimRecovery({
        runId: offered?.runId ?? '',
        revision: offered?.revision ?? -1,
        attemptId: 'failed-hydration-attempt',
      }),
    ).toEqual({ ok: false, error: 'storage-unavailable' });

    const reopened = harness({ backend: first.backend, generation: first.generation });
    expect((await reopened.repository.initialize()).ok).toBe(true);
    const retryable = reopened.repository.getSnapshot().recoveryCapsule;
    expect(retryable?.claim).toBeUndefined();
    expect(
      (
        await reopened.repository.claimRecovery({
          runId: retryable?.runId ?? '',
          revision: retryable?.revision ?? -1,
          attemptId: 'retry-attempt',
        })
      ).ok,
    ).toBe(true);
  });

  it('allows only one transactional claim across repository instances', async () => {
    const first = harness();
    await activeThenInterrupted(first.repository, 'run-shared');
    const second = harness({ backend: first.backend, generation: first.generation });
    await second.repository.refresh();
    const revision = first.repository.getSnapshot().recoveryCapsule?.revision ?? -1;

    const [left, right] = await Promise.all([
      first.repository.claimRecovery({
        runId: 'run-shared',
        revision,
        attemptId: 'left',
      }),
      second.repository.claimRecovery({
        runId: 'run-shared',
        revision,
        attemptId: 'right',
      }),
    ]);
    expect([left.ok, right.ok].filter(Boolean)).toHaveLength(1);
  });

  it('promotes a stale active run to an interrupted capsule on a new initialization', async () => {
    const first = harness();
    await first.repository.stageArtifact(artifact('run-stale'));
    await first.repository.activateFreshRun('run-stale', NOW);
    await first.repository.updateProgress('run-stale', 2, LATER);

    const reopened = harness({ backend: first.backend, generation: first.generation });
    expect((await reopened.repository.initialize()).ok).toBe(true);
    expect(reopened.repository.getSnapshot().activeRun).toBeNull();
    expect(reopened.repository.getSnapshot().recoveryCapsule).toMatchObject({
      runId: 'run-stale',
      ackedLines: 2,
      interruption: { kind: 'unknown' },
    });
  });

  it('migrates the legacy fingerprint-only slot without inventing G-code', async () => {
    const checkpoint = createJobCheckpoint({
      gcode: 'G21\nG1 X1\nM5\n',
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: NOW,
    });
    const legacy = { value: serializeJobCheckpoint(checkpoint) as string | null };
    const { repository } = harness({ legacy });

    expect((await repository.initialize()).ok).toBe(true);
    expect(legacy.value).toBeNull();
    const capsule = repository.getSnapshot().recoveryCapsule;
    expect(capsule?.artifact.kind).toBe('legacy-fingerprint-only');
    expect('gcode' in (capsule?.artifact ?? {})).toBe(false);
  });

  it('uses the purge generation marker to prevent resurrection after a failed purge', async () => {
    const first = harness();
    await activeThenInterrupted(first.repository, 'run-a');
    first.backend.failNext('purge');
    expect(await first.repository.purgeControllerData()).toEqual({
      ok: false,
      error: 'storage-unavailable',
    });
    expect(first.repository.getSnapshot().recoveryCapsule).toBeNull();

    const reopened = harness({ backend: first.backend, generation: first.generation });
    expect((await reopened.repository.initialize()).ok).toBe(true);
    expect(reopened.repository.getSnapshot().generation).toBe(1);
    expect(reopened.repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('invalidates old slots after an accepted untracked run even when slot cleanup fails', async () => {
    const first = harness();
    await activeThenInterrupted(first.repository, 'run-old');
    first.backend.failNext('mutate-slots');
    first.backend.failNext('purge');

    expect(await first.repository.noteUntrackedRunAccepted()).toEqual({
      ok: false,
      error: 'storage-unavailable',
    });
    expect(first.repository.getSnapshot().recoveryCapsule).toBeNull();
    const reopened = harness({ backend: first.backend, generation: first.generation });
    await reopened.repository.initialize();
    expect(reopened.repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('degrades corrupt slot state to an empty nonblocking snapshot', async () => {
    const { repository, backend } = harness();
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
    });
  });

  it('publishes stable snapshots for React subscribers', async () => {
    const { repository } = harness();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);
    await repository.refresh();
    await repository.stageArtifact(artifact('run-a'));
    await repository.activateFreshRun('run-a', NOW);
    unsubscribe();
    await repository.updateProgress('run-a', 1, LATER);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('retains controller observations strictly as archived artifact evidence', () => {
    const exact = artifact('run-evidence', undefined, {
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'fluidnc',
      controllerSessionEpoch: 7,
      wco: { x: 1, y: 2, z: 3 },
      overrides: { feed: 100, rapid: 100, spindle: 100 },
      workZZeroEvidence: null,
    });
    expect(exact.archivedControllerObservation).toMatchObject({
      controllerSessionEpoch: 7,
      detectedControllerKind: 'fluidnc',
      wco: { x: 1, y: 2, z: 3 },
    });
  });
});
