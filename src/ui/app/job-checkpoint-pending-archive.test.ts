import { afterEach, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createStartIntent } from '../state/recovery/start-intent';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { installJobCheckpointTracking } from './use-job-checkpoint';

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

it('defers progress during post-accept archival and retries after activation without a false storage warning', async () => {
  const now = '2026-09-22T01:00:00.000Z';
  const gcode = Array.from({ length: 60 }, (_, i) => `G1 X${i} S100`).join('\n');
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => now,
  });
  await repository.initialize();
  await repository.armFreshStartIntent(
    'archiving-run',
    createStartIntent({
      gcode,
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: now,
    }),
  );
  const reportFailure = vi.fn();
  const updateProgress = vi.spyOn(repository, 'updateProgress');
  uninstall = installJobCheckpointTracking(() => now, repository, reportFailure);
  const streamer = step(createStreamer(gcode)).state;
  useLaserStore.setState({
    activeRunId: 'archiving-run',
    streamer,
    connection: { kind: 'connected' },
  });
  useLaserStore.setState({ streamer: { ...streamer, completed: 25 } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(reportFailure).not.toHaveBeenCalled();
  expect(updateProgress).not.toHaveBeenCalled();
  expect(repository.getSnapshot().pendingStart?.runId).toBe('archiving-run');
  await repository.stageArtifact(
    await createCurrentTestExecutionArtifact({ runId: 'archiving-run', gcode, createdAtIso: now }),
  );
  await repository.activateFreshRun('archiving-run', now);

  // Activation retries the deferred observation without another controller event.
  await vi.waitFor(() => expect(repository.getSnapshot().activeRun?.ackedLines).toBe(25));
  expect(updateProgress.mock.calls.map(([, ackedLines]) => ackedLines)).toEqual([25]);

  // Once that retry is queued, ordinary streaming keeps the 25-line interval.
  useLaserStore.setState({ streamer: { ...streamer, completed: 26 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(repository.getSnapshot().activeRun?.ackedLines).toBe(25);
  expect(updateProgress.mock.calls.map(([, ackedLines]) => ackedLines)).toEqual([25]);
  useLaserStore.setState({ streamer: { ...streamer, completed: 50 } });
  await vi.waitFor(() => expect(repository.getSnapshot().activeRun?.ackedLines).toBe(50));
  expect(updateProgress.mock.calls.map(([, ackedLines]) => ackedLines)).toEqual([25, 50]);

  // An interruption persists its exact first acknowledgement even below the
  // next interval; trailing buffered acknowledgements cannot move that point.
  useLaserStore.setState({ streamer: { ...streamer, status: 'errored', completed: 51 } });
  useLaserStore.setState({ streamer: { ...streamer, status: 'errored', completed: 52 } });
  await vi.waitFor(() => expect(repository.getSnapshot().recoveryCapsule?.ackedLines).toBe(51));
  expect(repository.getSnapshot().recoveryCapsule?.runId).toBe('archiving-run');
  expect(repository.getSnapshot().activeRun).toBeNull();
  expect(updateProgress.mock.calls.map(([, ackedLines]) => ackedLines)).toEqual([25, 50]);
  expect(reportFailure).not.toHaveBeenCalled();
});
