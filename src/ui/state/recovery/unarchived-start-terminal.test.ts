import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { RecoveryRepository } from './recovery-repository';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { createStartIntent } from './start-intent';

const repositories: RecoveryRepository[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const repository of repositories.splice(0)) repository.abandonStartLease();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  repositories.push(repository);
  await repository.initialize();
  return { backend, repository };
}

async function arm(repository: RecoveryRepository, runId: string) {
  const intent = createStartIntent({
    gcode: 'G21\nG90\nM4 S0\nG1 X10 Y10 F1000 S500\nM5\n',
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: new Date().toISOString(),
  });
  expect(await repository.armFreshStartIntent(runId, intent)).toEqual({ ok: true, value: true });
}

function delayMutation(backend: MemoryRecoveryStorageBackend) {
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
  return { release, reached };
}

describe('unarchived accepted Start terminal ownership', () => {
  it('retries only the completed intent when storage temporarily cannot retire it', async () => {
    const { backend, repository } = await setup();
    await arm(repository, 'finished');
    backend.failNext('mutate-slots');
    expect(await repository.finishUnarchivedStart('finished', true)).toMatchObject({ ok: false });
    expect(repository.getSnapshot().pendingStart?.runId).toBe('finished');
    await vi.advanceTimersByTimeAsync(1_001);
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    await arm(repository, 'next');
    await vi.advanceTimersByTimeAsync(6_000);
    await repository.refresh();
    expect(repository.getSnapshot().pendingStart?.runId).toBe('next');
    expect(repository.getSnapshot().pendingStart?.leaseRenewedAtIso).toBeDefined();
  });

  it.each([0, 6_000])(
    'reconciles a stopped run in the same window after %s ms of lease renewal',
    async (delayMs) => {
      const { repository } = await setup();
      await arm(repository, 'stopped');
      await vi.advanceTimersByTimeAsync(delayMs);
      expect(repository.getSnapshot().pendingStart?.leaseRenewedAtIso).toBeUndefined();
      await repository.finishUnarchivedStart('stopped', false);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(repository.getSnapshot().pendingStart).toBeNull();
      expect(repository.getSnapshot().recoveryCapsule).toMatchObject({
        runId: 'stopped',
        interruption: { kind: 'unknown' },
      });
    },
  );

  it('a queued renewal cannot extend the stopped run lease', async () => {
    const { backend, repository } = await setup();
    await arm(repository, 'stopped');
    const delayed = delayMutation(backend);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(delayed.reached).toHaveBeenCalled();
    await repository.finishUnarchivedStart('stopped', false);
    delayed.release();
    await vi.advanceTimersByTimeAsync(4_001);
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('stopped');
  });

  it('keeps watching a stopped intent after transient storage reads fail', async () => {
    const { backend, repository } = await setup();
    await arm(repository, 'stopped');
    backend.failNext('read-slots');
    await repository.finishUnarchivedStart('stopped', false);
    backend.failNext('read-slots');
    await vi.advanceTimersByTimeAsync(15_001);
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('stopped');
  });

  it.each(['put-artifact', 'mutate-slots'] as const)(
    'retries a stopped intent after reconciliation fails at %s',
    async (operation) => {
      const { backend, repository } = await setup();
      await arm(repository, 'stopped');
      await repository.finishUnarchivedStart('stopped', false);
      backend.failNext(operation);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(repository.getSnapshot().pendingStart).toBeNull();
      expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('stopped');
    },
  );

  it.each(['replacement', 'purge'] as const)(
    'a delayed completed cleanup preserves a later intent after %s',
    async (replacement) => {
      const { backend, repository } = await setup();
      await arm(repository, 'old');
      const delayed = delayMutation(backend);
      const finishing = repository.finishUnarchivedStart('old', true);
      await vi.waitFor(() => expect(delayed.reached).toHaveBeenCalled());
      if (replacement === 'purge') await repository.purgeControllerData();
      else await repository.cancelPendingStart('old');
      // Reuse the id after a generation change to exercise the generation guard.
      const nextId = replacement === 'purge' ? 'old' : 'new';
      await arm(repository, nextId);
      delayed.release();
      expect(await finishing).toEqual({ ok: true, value: false });
      await vi.advanceTimersByTimeAsync(6_000);
      await repository.refresh();
      expect(repository.getSnapshot().pendingStart?.runId).toBe(nextId);
      expect(repository.getSnapshot().pendingStart?.leaseRenewedAtIso).toBeDefined();
    },
  );
});
