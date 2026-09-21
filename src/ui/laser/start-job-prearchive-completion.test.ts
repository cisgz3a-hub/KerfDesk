import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { useStore } from '../state';
import { dismissCompletedJobDisplay } from '../state/completed-job-display';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { resetStore } from '../state/test-helpers';
import {
  completeFramedRunCandidateForTest,
  installReviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { frameLaserSecondPass, startLaserSecondPass } from './second-pass-execution';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { runCompletedJobAgainFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalFrame = useLaserStore.getState().frame;
let uninstallReview = (): void => undefined;
let uninstallTracking = (): void => undefined;
let releaseArchive = (): void => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  releaseArchive();
  uninstallTracking();
  uninstallReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ ...initialLaserState(), frame: originalFrame });
  resetStore();
  vi.restoreAllMocks();
});

async function fixture() {
  const simulator = createGrblSimulator();
  await useLaserStore.getState().connect(simulator.adapter);
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  const source = await createSecondPassExecutionFixture(repository);
  useStore.setState({ project: source.source.prepared.project });
  return { simulator, backend, repository, source };
}

function delayNextArchive(backend: MemoryRecoveryStorageBackend) {
  const put = backend.putArtifact.bind(backend);
  const gate = new Promise<void>((resolve) => {
    releaseArchive = resolve;
  });
  return vi.spyOn(backend, 'putArtifact').mockImplementationOnce(async (record) => {
    await gate;
    return put(record);
  });
}

async function readyStart(
  kind: 'ordinary' | 'second pass' | 'Run Again',
  input: Awaited<ReturnType<typeof fixture>>,
): Promise<() => Promise<unknown>> {
  if (kind === 'Run Again') {
    // Seed replay through an actual accepted, settled ordinary Start so the
    // receipt and retained Frame evidence match the current compiled job.
    await installReviewPendingFramedRunPermitForCurrentState();
    const sourceStart = runStartJobFlow(input.repository);
    await vi.waitFor(() => expect(input.repository.getSnapshot().activeRun).not.toBeNull());
    await sourceStart;
    const runId = input.repository.getSnapshot().activeRun?.runId;
    if (runId === undefined) throw new Error('Expected accepted source run.');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(await input.repository.completeRun(runId)).toEqual({ ok: true, value: true });
    const receipt = input.repository.getSnapshot().lastCompletedReceipt;
    if (receipt === null) throw new Error('Expected completed source receipt.');
    return () => runCompletedJobAgainFlow(receipt, input.repository);
  }
  if (kind === 'ordinary') {
    await installReviewPendingFramedRunPermitForCurrentState();
    return () => runStartJobFlow(input.repository);
  }
  useLaserStore.setState({
    frame: vi.fn(async (_bounds, _feed, candidate) => {
      if (candidate === undefined) throw new Error('Expected exact second-pass Frame candidate.');
      completeFramedRunCandidateForTest(candidate);
    }),
  });
  const { source, prepared, selection } = input.source;
  const permit = await frameLaserSecondPass(source, prepared, selection);
  if (permit === null) throw new Error('Expected completed second-pass Frame.');
  return () => startLaserSecondPass(permit, input.repository);
}

describe('actual Start completion before post-accept artifact storage', () => {
  it.each(
    (['ordinary', 'Run Again'] as const).flatMap((kind) =>
      (['completed then Done and cable loss', 'cable loss', 'operator disconnect'] as const).map(
        (terminal) => ({ kind, terminal }),
      ),
    ),
  )(
    'settles $kind after $terminal without another controller update',
    async ({ kind, terminal }) => {
      const input = await fixture();
      const start = await readyStart(kind, input);
      const archive = delayNextArchive(input.backend);
      const completing = vi.spyOn(input.repository, 'completeRun');
      const interrupting = vi.spyOn(input.repository, 'interruptRun');
      const reportFailure = vi.fn();
      const onCompleted = vi.fn();
      uninstallTracking = installJobCheckpointTracking(
        () => new Date().toISOString(),
        input.repository,
        reportFailure,
        onCompleted,
      );
      const running = start();
      await vi.waitFor(() => expect(archive).toHaveBeenCalledOnce());
      const runId = input.repository.getSnapshot().pendingStart?.runId;
      expect(useLaserStore.getState().streamer).not.toBeNull();
      if (terminal === 'completed then Done and cable loss') {
        await vi.advanceTimersByTimeAsync(5_000);
        const completed = useLaserStore.getState().liveCanvasRun;
        if (completed === null || completed === undefined)
          throw new Error('Expected the completed live display.');
        expect(dismissCompletedJobDisplay(completed)).toBe(true);
      }
      if (terminal === 'operator disconnect') {
        const disconnecting = useLaserStore.getState().disconnect();
        await vi.advanceTimersByTimeAsync(1_000);
        await disconnecting;
      } else input.simulator.yankCable();
      await vi.advanceTimersByTimeAsync(1_000);
      for (let pass = 0; pass < 3; pass += 1) {
        await Promise.all(
          [...completing.mock.results, ...interrupting.mock.results].map((result) => result.value),
        );
        for (let tick = 0; tick < 30; tick += 1) await Promise.resolve();
      }
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      const statusSequence = useLaserStore.getState().statusSequence;
      const outbound = [...input.simulator.outbound()];
      const updatesBeforeTerminal: unknown[] = [];
      const stopObserving = useLaserStore.subscribe((state, prior) => {
        const snapshot = input.repository.getSnapshot();
        if (snapshot.activeRun?.runId === runId || snapshot.pendingStart?.runId === runId) {
          updatesBeforeTerminal.push(
            Object.keys(state).filter(
              (key) => state[key as keyof typeof state] !== prior[key as keyof typeof prior],
            ),
          );
        }
      });
      releaseArchive();
      await running;

      await vi.waitFor(() => expect(input.repository.getSnapshot().activeRun).toBeNull());
      stopObserving();
      // Archive activation settles the terminal before even ordinary Start's
      // Frame-claim cleanup. Run Again has no claim or further controller input.
      expect(updatesBeforeTerminal).toEqual([]);
      expect(useLaserStore.getState().statusSequence).toBe(statusSequence);
      expect(input.simulator.outbound()).toEqual(outbound);
      if (terminal === 'completed then Done and cable loss') {
        expect(input.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId);
        expect(onCompleted.mock.calls).toEqual([[runId]]);
      } else {
        expect(input.repository.getSnapshot().recoveryCapsule?.runId).toBe(runId);
        expect(onCompleted).not.toHaveBeenCalled();
      }
      expect(reportFailure).not.toHaveBeenCalled();
    },
  );

  it.each(['ordinary', 'second pass'] as const)(
    'retains %s completion while its archive is pending without a false tracking failure',
    async (kind) => {
      const input = await fixture();
      const start = await readyStart(kind, input);
      const archive = delayNextArchive(input.backend);
      const reportFailure = vi.fn();
      const onCompleted = vi.fn();
      uninstallTracking = installJobCheckpointTracking(
        () => new Date().toISOString(),
        input.repository,
        reportFailure,
        onCompleted,
      );
      const running = start();
      await vi.waitFor(() => expect(archive).toHaveBeenCalledOnce());
      const runId = input.repository.getSnapshot().pendingStart?.runId;
      expect(runId).toEqual(expect.any(String));
      expect(input.repository.getSnapshot().pendingStart?.intent).toBeDefined();
      expect(input.repository.getSnapshot().activeRun).toBeNull();
      expect(await input.backend.artifactExists(runId ?? '')).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(useLaserStore.getState()).toMatchObject({
        streamer: null,
        controllerOperation: null,
        liveCanvasRun: { lifecycle: 'finished', timing: { kind: 'complete' } },
      });
      expect(input.simulator.outbound()).toContain('G4 P0.01\n');
      expect(onCompleted).not.toHaveBeenCalled();
      const failuresBeforeArchive = [...reportFailure.mock.calls];
      releaseArchive();
      await running;
      await vi.advanceTimersByTimeAsync(1_500);
      await vi.waitFor(() => expect(onCompleted.mock.calls).toEqual([[runId]]));
      expect(input.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId);
      expect(input.repository.getSnapshot().pendingStart).toBeNull();
      expect(failuresBeforeArchive).toEqual([]);
      expect(reportFailure).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'reports a genuine terminal storage failure while the archive is pending (after no-op=%s)',
    async (afterExpectedNoop) => {
      const input = await fixture();
      const start = await readyStart('ordinary', input);
      const archive = delayNextArchive(input.backend);
      const complete = input.repository.completeRun.bind(input.repository);
      const completeSpy = vi.spyOn(input.repository, 'completeRun');
      if (afterExpectedNoop) completeSpy.mockImplementationOnce(complete);
      completeSpy.mockImplementationOnce((...args) => {
        input.backend.failNext('mutate-slots');
        return complete(...args);
      });
      const reportFailure = vi.fn();
      const onCompleted = vi.fn();
      uninstallTracking = installJobCheckpointTracking(
        () => new Date().toISOString(),
        input.repository,
        reportFailure,
        onCompleted,
      );
      const running = start();
      await vi.waitFor(() => expect(archive).toHaveBeenCalledOnce());
      const runId = input.repository.getSnapshot().pendingStart?.runId;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(reportFailure).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
      expect(onCompleted).not.toHaveBeenCalled();
      releaseArchive();
      await running;
      await vi.advanceTimersByTimeAsync(1_500);
      await vi.waitFor(() => expect(onCompleted.mock.calls).toEqual([[runId]]));
    },
  );
});
