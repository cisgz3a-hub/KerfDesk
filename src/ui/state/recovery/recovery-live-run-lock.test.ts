// ADR-369 Amendment 1: every window ran promoteStaleActiveRun on load and turned
// any active run into an "Interrupted job", including one another window was
// still streaming. The live window's progress and completion writes then fell on
// nothing, and Review → Start re-burned lines it had already finished.
import { describe, expect, it } from 'vitest';
import type { RunId } from './execution-artifact';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { RecoveryRunLocks, recoveryRunLockName } from './recovery-run-lock';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-09-25T10:00:00.000Z';

/** One origin's lock table, shared by its windows. A window that dies loses its
 * locks, as the browser releases them when a page closes or crashes. */
class SharedLockTable {
  private readonly held = new Map<string, symbol>();

  window(): { readonly locks: RecoveryRunLocks; readonly crash: () => void } {
    const owner = Symbol('window');
    const manager = {
      request: <T>(
        name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => Promise<T> | T,
      ): Promise<T> => this.request(owner, name, options, callback),
    } as unknown as LockManager;
    return {
      locks: new RecoveryRunLocks(manager),
      crash: () => {
        for (const [name, holder] of this.held) if (holder === owner) this.held.delete(name);
      },
    };
  }

  isHeld(runId: RunId): boolean {
    return this.held.has(recoveryRunLockName(runId));
  }

  private async request<T>(
    owner: symbol,
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    if (options.ifAvailable === true && this.held.has(name)) return callback(null);
    this.held.set(name, owner);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      if (this.held.get(name) === owner) this.held.delete(name);
    }
  }
}

function openWindow(
  shared: { backend: MemoryRecoveryStorageBackend; generation: MemoryRecoveryGenerationStore },
  locks: RecoveryRunLocks,
): RecoveryRepository {
  return new RecoveryRepository({
    backend: shared.backend,
    generationStore: shared.generation,
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
    runLocks: locks,
  });
}

async function streamingWindow(runId: RunId) {
  const shared = {
    backend: new MemoryRecoveryStorageBackend(),
    generation: new MemoryRecoveryGenerationStore(),
  };
  const table = new SharedLockTable();
  const first = table.window();
  const streaming = openWindow(shared, first.locks);
  expect((await streaming.initialize()).ok).toBe(true);
  await streaming.stageArtifact(
    await createCurrentTestExecutionArtifact({
      runId,
      gcode: 'G21\nG90\nG1 X1\nG1 X2\nG1 X3\nM5\n',
      createdAtIso: NOW,
    }),
  );
  expect((await streaming.activateFreshRun(runId, NOW)).ok).toBe(true);
  expect((await streaming.updateProgress(runId, 2, NOW)).ok).toBe(true);
  return { shared, table, streaming, crashStreamingWindow: first.crash };
}

describe('a second window and a run another window is streaming', () => {
  it('leaves the live run active, and its window keeps recording it', async () => {
    const { shared, table, streaming } = await streamingWindow('run-live');
    expect(table.isHeld('run-live')).toBe(true);

    const second = openWindow(shared, table.window().locks);
    expect((await second.initialize()).ok).toBe(true);
    expect(second.getSnapshot().activeRun?.runId).toBe('run-live');
    expect(second.getSnapshot().recoveryCapsule).toBeNull();

    // The streaming window still owns the run: progress lands, completion clears it.
    expect((await streaming.updateProgress('run-live', 4, NOW)).ok).toBe(true);
    expect(await streaming.completeRun('run-live', NOW)).toMatchObject({ ok: true, value: true });
    await second.refresh();
    expect(second.getSnapshot().activeRun).toBeNull();
    expect(second.getSnapshot().recoveryCapsule).toBeNull();
    expect(table.isHeld('run-live')).toBe(false);
  });

  it('still promotes the run once the window that streamed it is gone', async () => {
    const { shared, table, crashStreamingWindow } = await streamingWindow('run-orphan');
    crashStreamingWindow();

    const reopened = openWindow(shared, table.window().locks);
    expect((await reopened.initialize()).ok).toBe(true);
    expect(reopened.getSnapshot().activeRun).toBeNull();
    expect(reopened.getSnapshot().recoveryCapsule).toMatchObject({
      runId: 'run-orphan',
      ackedLines: 2,
      interruption: { kind: 'unknown' },
    });
  });
});
