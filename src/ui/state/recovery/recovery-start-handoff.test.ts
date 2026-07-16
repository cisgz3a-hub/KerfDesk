import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { createExecutionArtifact, type RunId } from './execution-artifact';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';

function artifact(runId: RunId) {
  const project = {
    device: {
      controllerKind: 'grbl-v1.1',
      streamingMode: 'char-counted',
      rxBufferBytes: 120,
    },
  } as unknown as Project;
  return createExecutionArtifact({
    runId,
    gcode: 'G21\nG90\nG1 X1\nM5\n',
    prepared: {
      ok: true,
      project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } as Extract<PreparedOutput, { readonly ok: true }>,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: { maxPowerS: 1_000, laserModeEnabled: true },
    createdAtIso: NOW,
  });
}

function harness(options?: {
  readonly backend?: MemoryRecoveryStorageBackend;
  readonly generation?: MemoryRecoveryGenerationStore;
}) {
  const backend = options?.backend ?? new MemoryRecoveryStorageBackend();
  const generation = options?.generation ?? new MemoryRecoveryGenerationStore();
  return {
    backend,
    generation,
    repository: new RecoveryRepository({
      backend,
      generationStore: generation,
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => LATER,
    }),
  };
}

async function interrupt(repository: RecoveryRepository, runId: RunId): Promise<void> {
  expect((await repository.stageArtifact(artifact(runId))).ok).toBe(true);
  expect((await repository.activateFreshRun(runId, NOW)).ok).toBe(true);
  expect(
    (
      await repository.interruptRun(
        runId,
        2,
        { kind: 'disconnect', message: 'Cable removed.' },
        LATER,
      )
    ).ok,
  ).toBe(true);
}

function success<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected recovery repository operation to succeed.');
  return result.value;
}

describe('durable Start handoff', () => {
  afterEach(() => vi.useRealTimers());

  it('reconciles a crashed fresh Start as the newest uncertain capsule', async () => {
    const first = harness();
    await interrupt(first.repository, 'run-old');
    await first.repository.stageArtifact(artifact('run-new'));

    expect(success(await first.repository.armFreshStart('run-new', NOW))).toBe(true);
    expect(first.repository.getSnapshot().recoveryCapsule?.runId).toBe('run-old');

    const reopened = harness({ backend: first.backend, generation: first.generation });
    expect((await reopened.repository.initialize()).ok).toBe(true);
    expect(reopened.repository.getSnapshot().pendingStart).toBeNull();
    expect(reopened.repository.getSnapshot().recoveryCapsule).toMatchObject({
      runId: 'run-new',
      ackedLines: 0,
      interruption: { message: expect.stringContaining('Motion may or may not have begun') },
    });
  });

  it('does not let a second live window reconcile an active owner lease', async () => {
    const first = harness();
    await first.repository.stageArtifact(artifact('run-live-owner'));
    await first.repository.armFreshStart('run-live-owner', LATER);

    const second = harness({ backend: first.backend, generation: first.generation });
    expect((await second.repository.initialize()).ok).toBe(true);
    expect(second.repository.getSnapshot().pendingStart?.runId).toBe('run-live-owner');

    expect(success(await first.repository.activateFreshRun('run-live-owner', LATER))).toBe(true);
    await second.repository.refresh();
    expect(second.repository.getSnapshot().activeRun?.runId).toBe('run-live-owner');
  });

  it('bounds a future clock-skewed owner timestamp to one local lease', async () => {
    vi.useFakeTimers();
    const first = harness();
    await first.repository.stageArtifact(artifact('run-clock-skew'));
    await first.repository.armFreshStart('run-clock-skew', '2099-01-01T00:00:00.000Z');

    const reopened = harness({ backend: first.backend, generation: first.generation });
    await reopened.repository.initialize();
    expect(reopened.repository.getSnapshot().pendingStart?.runId).toBe('run-clock-skew');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(reopened.repository.getSnapshot().pendingStart).toBeNull();
    expect(reopened.repository.getSnapshot().recoveryCapsule?.runId).toBe('run-clock-skew');
  });

  it('cancels a refused Start without disturbing the older capsule', async () => {
    const { repository, backend } = harness();
    await interrupt(repository, 'run-old');
    await repository.stageArtifact(artifact('run-refused'));
    await repository.armFreshStart('run-refused', NOW);

    expect(success(await repository.cancelPendingStart('run-refused'))).toBe(true);
    expect(success(await repository.discardStagedRun('run-refused'))).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-old');
    expect(await backend.getArtifact('run-refused')).toBeNull();
  });

  it('reconciles a crashed supervised recovery without reviving its source', async () => {
    const first = harness();
    await interrupt(first.repository, 'run-source');
    const offered = first.repository.getSnapshot().recoveryCapsule;
    const claimed = await first.repository.claimRecovery({
      runId: 'run-source',
      revision: offered?.revision ?? -1,
      attemptId: 'attempt-crash',
    });
    if (!claimed.ok) throw new Error('Expected recovery claim to succeed.');
    await first.repository.stageArtifact(artifact('run-recovery-attempt'));
    expect(
      success(
        await first.repository.armClaimedRecoveryStart({
          sourceRunId: 'run-source',
          sourceRevision: claimed.value.revision,
          attemptId: 'attempt-crash',
          recoveryRunId: 'run-recovery-attempt',
          armedAtIso: NOW,
        }),
      ),
    ).toBe(true);

    const reopened = harness({ backend: first.backend, generation: first.generation });
    await reopened.repository.initialize();
    expect(reopened.repository.getSnapshot().recoveryCapsule?.runId).toBe('run-recovery-attempt');
    expect(await first.backend.getArtifact('run-source')).toBeNull();
  });

  it('migrates schema-v1 slots without dropping the recovery capsule', async () => {
    const first = harness();
    await interrupt(first.repository, 'run-v1');
    await first.backend.mutateSlots((raw) => {
      const current = raw as Record<string, unknown>;
      const { pendingStart: _pendingStart, ...v1 } = current;
      return { slots: { ...v1, schemaVersion: 1 } as never, value: undefined };
    });

    const reopened = harness({ backend: first.backend, generation: first.generation });
    expect((await reopened.repository.initialize()).ok).toBe(true);
    expect(reopened.repository.getSnapshot().recoveryCapsule?.runId).toBe('run-v1');
    expect(reopened.repository.getSnapshot().pendingStart).toBeNull();
  });

  it('purges pending Start state so Forget Controller cannot resurrect it', async () => {
    const first = harness();
    await first.repository.stageArtifact(artifact('run-pending-forget'));
    await first.repository.armFreshStart('run-pending-forget', NOW);

    expect((await first.repository.purgeControllerData()).ok).toBe(true);
    const reopened = harness({ backend: first.backend, generation: first.generation });
    await reopened.repository.initialize();
    expect(reopened.repository.getSnapshot().pendingStart).toBeNull();
    expect(reopened.repository.getSnapshot().recoveryCapsule).toBeNull();
  });
});
