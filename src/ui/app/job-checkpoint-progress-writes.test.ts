// Progress checkpoints are a read-write IndexedDB transaction each. A big job
// acknowledges hundreds of lines a second, so the tracker must bound how many
// it issues: one in flight plus one waiting, and none at all for a run the
// repository does not own.

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createStreamer, step, type StreamerState } from '../../core/controllers/grbl';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const GCODE = Array.from({ length: 400 }, (_, index) => `G1 X${index} S100`).join('\n');
const NOW = '2026-07-15T10:00:00.000Z';

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  useLaserStore.setState(initialLaserState());
});

function harness(): {
  readonly backend: MemoryRecoveryStorageBackend;
  readonly repo: RecoveryRepository;
  readonly reportFailure: Mock<(error: unknown) => void>;
} {
  const backend = new MemoryRecoveryStorageBackend();
  const repo = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
  return { backend, repo, reportFailure: vi.fn<(error: unknown) => void>() };
}

async function stage(repo: RecoveryRepository, runId: string): Promise<void> {
  await repo.stageArtifact(
    await createCurrentTestExecutionArtifact({ runId, gcode: GCODE, createdAtIso: NOW }),
  );
}

function beginStream(runId: string): StreamerState {
  const base = step(createStreamer(GCODE)).state;
  useLaserStore.setState({ activeRunId: runId, streamer: base, connection: { kind: 'connected' } });
  return base;
}

/** Three store writes per acknowledgement, as the live line handler makes. */
async function acknowledge(base: StreamerState, from: number, to: number): Promise<void> {
  for (let completed = from; completed <= to; completed += 1) {
    for (let write = 0; write < 3; write += 1) {
      useLaserStore.setState({ streamer: { ...base, completed } });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// Each acknowledgement yields a real macrotask so the tracker's IndexedDB-shaped
// writes interleave as they do live; a few hundred of them take seconds on a
// loaded runner, well past the 5 s default.
describe('checkpoint progress writes', { timeout: 30_000 }, () => {
  it('coalesces acknowledgements behind the write in flight into one latest write', async () => {
    const { repo, reportFailure } = harness();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => NOW, repo, reportFailure);
    await stage(repo, 'run-slow-disk');
    await repo.activateFreshRun('run-slow-disk', NOW);
    const base = beginStream('run-slow-disk');
    const original = repo.updateProgress.bind(repo);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updateProgress = vi
      .spyOn(repo, 'updateProgress')
      .mockImplementation(async (runId, ackedLines, updatedAtIso) => {
        if (ackedLines === 25) await held;
        return original(runId, ackedLines, updatedAtIso);
      });

    await acknowledge(base, 1, 100);
    release();

    await vi.waitFor(() => expect(repo.getSnapshot().activeRun?.ackedLines).toBe(100));
    expect(updateProgress.mock.calls.map(([, ackedLines]) => ackedLines)).toEqual([25, 100]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('keeps the exact interrupted ack when trailing oks arrive behind a slow write', async () => {
    const { repo, reportFailure } = harness();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => NOW, repo, reportFailure);
    await stage(repo, 'run-errored');
    await repo.activateFreshRun('run-errored', NOW);
    const base = beginStream('run-errored');
    const original = repo.updateProgress.bind(repo);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(repo, 'updateProgress').mockImplementation(async (runId, ackedLines, updatedAtIso) => {
      if (ackedLines === 25) await held;
      return original(runId, ackedLines, updatedAtIso);
    });

    // Write 25 is held and 50 waits behind it when GRBL rejects line 61. The
    // lines it had already buffered still answer ok, so the terminal streamer's
    // count keeps climbing after the interruption is queued.
    await acknowledge(base, 1, 60);
    const errored: StreamerState = { ...base, status: 'errored' };
    await acknowledge(errored, 61, 80);
    release();

    await vi.waitFor(() => expect(repo.getSnapshot().recoveryCapsule?.ackedLines).toBe(61));
    await vi.waitFor(() => expect(repo.getSnapshot().activeRun).toBeNull());
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('stops writing progress for a run the repository does not own until it activates', async () => {
    const { backend, repo, reportFailure } = harness();
    await repo.initialize();
    uninstall = installJobCheckpointTracking(() => NOW, repo, reportFailure);
    await stage(repo, 'run-untracked');
    const base = beginStream('run-untracked');
    const mutateSlots = vi.spyOn(backend, 'mutateSlots');

    await acknowledge(base, 1, 200);

    // One no-op discovers the run is untracked. Each no-op used to re-arm the
    // next, chaining 176 read-write transactions over these 200 lines.
    expect(mutateSlots).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledOnce();

    await repo.activateFreshRun('run-untracked', NOW);
    await acknowledge(base, 201, 201);

    await vi.waitFor(() => expect(repo.getSnapshot().activeRun?.ackedLines).toBe(201));
  });
});
