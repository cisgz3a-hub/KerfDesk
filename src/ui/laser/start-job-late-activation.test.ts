import { afterEach, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { activateAcceptedFreshRun } from './start-job-execution-tracking';
import { observeFreshExecutionRetention } from './start-job-retained-execution';

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
  useLaserStore.setState(initialLaserState());
});

it('does not let a late successful activation replace the newer active run', async () => {
  useLaserStore.setState(initialLaserState());
  vi.useFakeTimers();
  const simulator = createGrblSimulator();
  await useLaserStore.getState().connect(simulator.adapter);
  await vi.advanceTimersByTimeAsync(1200);
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  const fixture = await createSecondPassExecutionFixture(repository);
  const a = await createCurrentTestExecutionArtifact({ runId: 'older-activation' });
  const b = await createCurrentTestExecutionArtifact({ runId: 'newer-active-run' });
  await repository.stageArtifact(a);
  await repository.armFreshStart(a.runId);
  const retention = observeFreshExecutionRetention(a.runId, repository);
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = (): void => undefined;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const exists = backend.artifactExists.bind(backend);
  vi.spyOn(backend, 'artifactExists').mockImplementation(async (runId) => {
    if (runId === a.runId) {
      entered();
      await gate;
    }
    return exists(runId);
  });
  const activating = activateAcceptedFreshRun(
    a.runId,
    { staged: true, keep: () => a },
    repository,
    retention,
    fixture.prepared,
    () => undefined,
  );
  await waiting;
  await repository.cancelPendingStart(a.runId);
  await repository.stageArtifact(b);
  await repository.activateFreshRun(b.runId);
  useLaserStore.setState({ activeRunId: b.runId });
  expect(retention.current()).toBe(false);
  release();
  await activating;
  retention.stop();
  expect(repository.getSnapshot().activeRun?.runId).toBe(b.runId);
});
