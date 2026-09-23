import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createStartIntent } from '../state/recovery/start-intent';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { reportStartBlockers } from './start-blocker-invalidation';
import { armFreshStartHandoff, START_HANDOFF_SETTLE_WAIT_MS } from './start-handoff-arming';
import type { PreparedStartArgs } from './start-job-transmission';

vi.mock('./start-blocker-invalidation', () => ({ reportStartBlockers: vi.fn() }));

const GCODE = 'G21\nG90\nM4 S0\nG1 X10 F600 S200\nM5\n';

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(reportStartBlockers).mockClear();
});

async function repository(): Promise<RecoveryRepository> {
  const created = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await created.initialize();
  return created;
}

/** The fields the handoff reads; the rest of a prepared Start is irrelevant here. */
function startArgs(repo: RecoveryRepository): PreparedStartArgs {
  return {
    prepared: { gcode: GCODE },
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    repository: repo,
  } as unknown as PreparedStartArgs;
}

function intent() {
  return createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: new Date().toISOString(),
  });
}

async function activeRun(repo: RecoveryRepository, runId: string): Promise<void> {
  expect((await repo.armFreshStartIntent(runId, intent())).ok).toBe(true);
  await repo.stageArtifact(await createCurrentTestExecutionArtifact({ runId, gcode: GCODE }));
  expect(await repo.activateFreshRun(runId)).toMatchObject({ ok: true, value: true });
}

describe('arming a fresh Start handoff', () => {
  it('waits for the previous run record to close instead of refusing Start', async () => {
    const repo = await repository();
    await activeRun(repo, 'run-previous');
    // The previous job's completion is still being saved when Start is pressed.
    setTimeout(() => void repo.completeRun('run-previous'), 60);
    expect(await armFreshStartHandoff(startArgs(repo), 'run-next')).toEqual({
      armed: true,
      blocked: false,
    });
    expect(repo.getSnapshot().pendingStart?.runId).toBe('run-next');
    expect(reportStartBlockers).not.toHaveBeenCalled();
  });

  it('names another Start that still holds the handoff after the wait', async () => {
    vi.useFakeTimers();
    const repo = await repository();
    expect((await repo.armFreshStartIntent('run-other', intent())).ok).toBe(true);
    const arming = armFreshStartHandoff(startArgs(repo), 'run-next');
    await vi.advanceTimersByTimeAsync(START_HANDOFF_SETTLE_WAIT_MS + 100);
    expect(await arming).toEqual({ armed: false, blocked: true });
    expect(reportStartBlockers).toHaveBeenCalledWith([
      expect.stringContaining('Another job Start is still being handed to the controller'),
    ]);
    expect(repo.getSnapshot().pendingStart?.runId).toBe('run-other');
  });

  it('names a previous job still recorded as running after the wait', async () => {
    vi.useFakeTimers();
    const repo = await repository();
    await activeRun(repo, 'run-elsewhere');
    const arming = armFreshStartHandoff(startArgs(repo), 'run-next');
    await vi.advanceTimersByTimeAsync(START_HANDOFF_SETTLE_WAIT_MS + 100);
    expect(await arming).toEqual({ armed: false, blocked: true });
    expect(reportStartBlockers).toHaveBeenCalledWith([
      expect.stringContaining('The previous job is still recorded as running'),
    ]);
  });
});
