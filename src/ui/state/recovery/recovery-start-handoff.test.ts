import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import type { RunId } from './execution-artifact';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { validRecoverySlots } from './recovery-model';
import { RecoveryRepository } from './recovery-repository';
import {
  armFreshStartIntentMutation,
  cancelPendingStartMutation,
} from './recovery-start-handoff-mutations';
import { createStartIntent, START_INTENT_INTERRUPTION_MESSAGE } from './start-intent';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';
// The fixture archive's program, so an intent and its archive describe one run.
const GCODE = 'G21\nG90\nG1 X1\nM5\n';

function artifact(runId: RunId) {
  return createCurrentTestExecutionArtifact({
    runId,
    gcode: GCODE,
    createdAtIso: NOW,
  });
}

function startIntent() {
  return createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
}

function harness(options?: {
  readonly backend?: MemoryRecoveryStorageBackend;
  readonly generation?: MemoryRecoveryGenerationStore;
  readonly nowIso?: () => string;
  readonly onSlotsChanged?: () => void;
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
      nowIso: options?.nowIso ?? (() => LATER),
      ...(options?.onSlotsChanged === undefined ? {} : { onSlotsChanged: options.onSlotsChanged }),
    }),
  };
}

/** What a window that died mid-Start leaves behind: its durable record alone. */
async function armedByDeadWindow(
  backend: MemoryRecoveryStorageBackend,
  runId: RunId,
  armedAtIso: string,
): Promise<void> {
  await backend.mutateSlots((raw) =>
    armFreshStartIntentMutation(validRecoverySlots(raw, 0), runId, startIntent(), armedAtIso),
  );
}

/** WebCrypto runs on the libuv pool, outside the fake clock, so a real digest
 * inside a reconciliation would race the advanced lease. Hash on the microtask
 * queue instead: each advanced timer then settles every storage await. */
function hashOnMicrotasks(): void {
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (_algorithm, data) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
  });
}

/** A second window's clock under fake timers: the lease is measured on it. */
const fakeClockIso = (): string => new Date().toISOString();

async function interrupt(repository: RecoveryRepository, runId: RunId): Promise<void> {
  expect((await repository.stageArtifact(await artifact(runId))).ok).toBe(true);
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
    await first.repository.stageArtifact(await artifact('run-new'));

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
    await first.repository.stageArtifact(await artifact('run-live-owner'));
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
    await first.repository.stageArtifact(await artifact('run-clock-skew'));
    await first.repository.armFreshStart('run-clock-skew', '2099-01-01T00:00:00.000Z');

    const reopened = harness({ backend: first.backend, generation: first.generation });
    await reopened.repository.initialize();
    expect(reopened.repository.getSnapshot().pendingStart?.runId).toBe('run-clock-skew');

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(reopened.repository.getSnapshot().pendingStart).toBeNull());
    expect(reopened.repository.getSnapshot().recoveryCapsule?.runId).toBe('run-clock-skew');
  });

  it('cancels a refused Start without disturbing the older capsule', async () => {
    const { repository, backend } = harness();
    await interrupt(repository, 'run-old');
    await repository.stageArtifact(await artifact('run-refused'));
    await repository.armFreshStart('run-refused', NOW);

    expect(success(await repository.cancelPendingStart('run-refused'))).toBe(true);
    expect(success(await repository.discardStagedRun('run-refused'))).toBe(true);
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('run-old');
    expect(await backend.getArtifact('run-refused')).toBeNull();
  });

  it('reconciles a crashed supervised recovery without reviving or deleting its archived source', async () => {
    const first = harness();
    await interrupt(first.repository, 'run-source');
    const offered = first.repository.getSnapshot().recoveryCapsule;
    const claimed = await first.repository.claimRecovery({
      runId: 'run-source',
      revision: offered?.revision ?? -1,
      attemptId: 'attempt-crash',
    });
    if (!claimed.ok) throw new Error('Expected recovery claim to succeed.');
    await first.repository.stageArtifact(await artifact('run-recovery-attempt'));
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
    expect(await first.backend.getArtifact('run-source')).not.toBeNull();
    expect(await reopened.repository.getArchivedExecution('run-source')).toMatchObject({
      ok: true,
    });
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
    await first.repository.stageArtifact(await artifact('run-pending-forget'));
    await first.repository.armFreshStart('run-pending-forget', NOW);

    expect((await first.repository.purgeControllerData()).ok).toBe(true);
    const reopened = harness({ backend: first.backend, generation: first.generation });
    await reopened.repository.initialize();
    expect(reopened.repository.getSnapshot().pendingStart).toBeNull();
    expect(reopened.repository.getSnapshot().recoveryCapsule).toBeNull();
  });
});

// ADR-337 builds the archive after the controller accepts the program, inside
// the owner lease a second window waits out before reconciling. A big job's
// archive can outlast that lease while its owner window is alive and streaming.
describe('an intent-armed Start whose archive outlasts the owner lease', () => {
  beforeEach(() => hashOnMicrotasks());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function liveOwnerAndSecondWindow(onSlotsChanged?: () => void) {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const owner = harness({
      nowIso: fakeClockIso,
      ...(onSlotsChanged === undefined ? {} : { onSlotsChanged }),
    });
    expect((await owner.repository.initialize()).ok).toBe(true);
    expect(success(await owner.repository.armFreshStartIntent('run-live', startIntent()))).toBe(
      true,
    );
    // Another window opens while the controller takes the program.
    const second = harness({
      backend: owner.backend,
      generation: owner.generation,
      nowIso: fakeClockIso,
    });
    expect((await second.repository.initialize()).ok).toBe(true);
    expect(second.repository.getSnapshot().pendingStart?.runId).toBe('run-live');
    return { owner: owner.repository, second: second.repository, backend: owner.backend };
  }

  it('leaves the handoff alone while the owner is still building the archive', async () => {
    const archive = await artifact('run-live');
    const announced = vi.fn();
    const { owner, second } = await liveOwnerAndSecondWindow(announced);
    expect(announced).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    await second.refresh();
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: { runId: 'run-live', leaseRenewedAtIso: expect.any(String) },
      recoveryCapsule: null,
    });
    // Renewals are liveness writes, like progress: other windows are not told
    // to reload for each one.
    expect(announced).toHaveBeenCalledTimes(1);

    expect(await owner.stageArtifact(archive)).toEqual({ ok: true, value: 'run-live' });
    expect(success(await owner.activateFreshRun('run-live'))).toBe(true);
    await second.refresh();
    expect(second.getSnapshot()).toMatchObject({
      activeRun: { runId: 'run-live', ackedLines: 0 },
      pendingStart: null,
      recoveryCapsule: null,
      executionHistory: [],
    });
  });

  it('leaves the handoff alone between storing the archive and activating it', async () => {
    const archive = await artifact('run-live');
    const { owner, second } = await liveOwnerAndSecondWindow();
    expect(await owner.stageArtifact(archive)).toEqual({ ok: true, value: 'run-live' });

    await vi.advanceTimersByTimeAsync(12_000);
    await second.refresh();
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: { runId: 'run-live' },
      recoveryCapsule: null,
      executionHistory: [],
    });

    expect(success(await owner.activateFreshRun('run-live'))).toBe(true);
    expect(owner.getSnapshot().activeRun?.runId).toBe('run-live');
    // The run the controller is executing keeps its progress and completion.
    expect(success(await owner.updateProgress('run-live', 3))).toBe(true);
    expect(success(await owner.completeRun('run-live'))).toBe(true);
    await second.refresh();
    expect(second.getSnapshot()).toMatchObject({
      activeRun: null,
      recoveryCapsule: null,
      lastCompletedReceipt: { runId: 'run-live' },
      executionHistory: [{ runId: 'run-live', terminalKind: 'completed' }],
    });
  });

  it('reconciles the handoff once its owner window dies mid-archive', async () => {
    const { owner, second, backend } = await liveOwnerAndSecondWindow();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(second.getSnapshot().pendingStart?.runId).toBe('run-live');

    owner.abandonStartLease();
    const lastWord = (await backend.readSlots()) as { readonly pendingStart: unknown };
    expect(lastWord.pendingStart).toMatchObject({ leaseRenewedAtIso: expect.any(String) });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: null,
      recoveryCapsule: {
        runId: 'run-live',
        artifactKind: 'legacy-fingerprint-only',
        ackedLines: 0,
        interruption: { kind: 'unknown', message: START_INTENT_INTERRUPTION_MESSAGE },
      },
    });
  });

  it('still reconciles an intent whose owner died inside the lease', async () => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const { backend, generation } = harness();
    await armedByDeadWindow(backend, 'run-dead', NOW);
    const second = harness({ backend, generation, nowIso: fakeClockIso }).repository;
    expect((await second.initialize()).ok).toBe(true);
    expect(second.getSnapshot().pendingStart?.runId).toBe('run-dead');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: null,
      recoveryCapsule: {
        runId: 'run-dead',
        artifactKind: 'legacy-fingerprint-only',
        ackedLines: 0,
        interruption: { kind: 'unknown', message: START_INTENT_INTERRUPTION_MESSAGE },
      },
    });
  });

  it('still reconciles an archived intent whose owner died before activating it', async () => {
    const archive = await artifact('run-dead');
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const { backend, generation } = harness();
    await armedByDeadWindow(backend, 'run-dead', NOW);
    const stager = harness({ backend, generation, nowIso: fakeClockIso }).repository;
    expect(await stager.stageArtifact(archive)).toEqual({ ok: true, value: 'run-dead' });
    const second = harness({ backend, generation, nowIso: fakeClockIso }).repository;
    expect((await second.initialize()).ok).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    // ADR-341 Amendment 3 item 7: the stored archive backs the capsule, and
    // the run history, where that archive is read, records the interruption.
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: null,
      recoveryCapsule: { runId: 'run-dead', artifactKind: 'exact-execution', ackedLines: 0 },
      executionHistory: [{ runId: 'run-dead', terminalKind: 'interrupted', ackedLines: 0 }],
    });
  });

  it('gives a newer Start that replaced the watched one a lease of its own', async () => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const { backend, generation } = harness();
    await armedByDeadWindow(backend, 'run-first', NOW);
    const second = harness({ backend, generation, nowIso: fakeClockIso }).repository;
    expect((await second.initialize()).ok).toBe(true);

    // Just before the watched lease lapses, its Start is cancelled and another
    // one is armed in its place.
    await vi.advanceTimersByTimeAsync(4_900);
    await backend.mutateSlots((raw) =>
      cancelPendingStartMutation(validRecoverySlots(raw, 0), 'run-first'),
    );
    await armedByDeadWindow(backend, 'run-newer', fakeClockIso());
    await vi.advanceTimersByTimeAsync(200);
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: { runId: 'run-newer' },
      recoveryCapsule: null,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(second.getSnapshot()).toMatchObject({
      pendingStart: null,
      recoveryCapsule: { runId: 'run-newer', ackedLines: 0 },
    });
  });
});
