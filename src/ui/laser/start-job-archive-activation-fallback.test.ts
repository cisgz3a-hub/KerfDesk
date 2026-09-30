import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { rotaryAppliesTo } from '../../core/job';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { clearUnarchivedRun, useUnarchivedRunStore } from '../state/laser-unarchived-run';
import { useLaserSecondPassUiStore } from '../state/laser-second-pass-ui-store';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { secondPassOfferable } from './second-pass/second-pass-offer';
import { runStartJobFlow } from './start-job-flow';
import { activateAcceptedFreshRun } from './start-job-execution-tracking';
import { observeFreshExecutionRetention } from './start-job-retained-execution';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

let uninstallReview = (): void => undefined;
let uninstallTracking = (): void => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  clearUnarchivedRun();
  useLaserSecondPassUiStore.setState({ completionRunId: null, lastOfferedRunId: null });
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  uninstallTracking();
  uninstallReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  clearUnarchivedRun();
  resetStore();
  vi.restoreAllMocks();
});

async function prepareRun(rotary = false) {
  const simulator = createGrblSimulator();
  await useLaserStore.getState().connect(simulator.adapter);
  await vi.advanceTimersByTimeAsync(1_200);
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  const base = createProject().device;
  const fixture = await createSecondPassExecutionFixture(
    repository,
    undefined,
    rotary
      ? {
          ...base,
          rotary: { enabled: true, type: 'roller', mmPerRotation: 100, objectDiameterMm: 40 },
        }
      : undefined,
  );
  useStore.setState({ project: fixture.source.prepared.project });
  const reportFailure = vi.fn();
  const onCompleted = vi.fn((runId: string) =>
    useLaserSecondPassUiStore.getState().offerCompletion(runId),
  );
  uninstallTracking = installJobCheckpointTracking(
    () => new Date().toISOString(),
    repository,
    reportFailure,
    onCompleted,
  );
  if (rotary) {
    const framing = runFrameNow();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await framing).toBe(true);
  } else await installReviewPendingFramedRunPermitForCurrentState();
  return { repository, backend, reportFailure, onCompleted, simulator, fixture };
}

function delayFailedActivation(
  repository: RecoveryRepository,
  backend: MemoryRecoveryStorageBackend,
) {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = vi.fn();
  const answered = vi.fn();
  const activate = repository.activateFreshRun.bind(repository);
  vi.spyOn(repository, 'activateFreshRun').mockImplementationOnce(async (...args) => {
    reached();
    await gate;
    const mutate = backend.mutateSlotsWithArtifact.bind(backend);
    vi.spyOn(backend, 'mutateSlotsWithArtifact').mockImplementationOnce((...input) => {
      backend.failNext('mutate-slots');
      return mutate(...input);
    });
    const result = await activate(...args);
    answered(result);
    return result;
  });
  return { release, reached, answered };
}

describe('archive activation fallback and second-pass eligibility', () => {
  it('retains an accepted execution when archive activation fails after staging', async () => {
    const { repository, backend, reportFailure, onCompleted } = await prepareRun();
    const activate = repository.activateFreshRun.bind(repository);
    const activationResult = vi.fn();
    vi.spyOn(repository, 'activateFreshRun').mockImplementationOnce(async (...args) => {
      backend.failNext('mutate-slots');
      const result = await activate(...args);
      activationResult(result);
      return result;
    });

    const starting = runStartJobFlow(repository);
    await vi.waitFor(() => expect(activationResult).toHaveBeenCalled());
    const runId = useLaserStore.getState().activeRunId;
    expect(activationResult.mock.calls[0]?.[0]).toMatchObject({ ok: false });
    await vi.advanceTimersByTimeAsync(5_000);
    await starting;
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(useLaserStore.getState().streamer).toBeNull();
    // Same fallback as a failed put-artifact should preserve the accepted run.
    expect(useUnarchivedRunStore.getState().completedRun?.runId).toBe(runId);
    expect(onCompleted.mock.calls).toEqual([[runId]]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('offers an already settled short run when delayed activation fails', async () => {
    const { repository, backend, reportFailure } = await prepareRun();
    const activation = delayFailedActivation(repository, backend);
    const starting = runStartJobFlow(repository);
    await vi.waitFor(() => expect(activation.reached).toHaveBeenCalled());
    const runId = useLaserStore.getState().activeRunId;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useUnarchivedRunStore.getState().completedRun).toBeNull();
    activation.release();
    await starting;
    expect(useUnarchivedRunStore.getState().completedRun?.runId).toBe(runId);
    expect(useLaserSecondPassUiStore.getState().completionRunId).toBe(runId);
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('does not revive a disconnected run while activation is pending and retains its short recovery record', async () => {
    const { repository, backend, onCompleted, simulator } = await prepareRun();
    const activation = delayFailedActivation(repository, backend);
    const starting = runStartJobFlow(repository);
    await vi.waitFor(() => expect(activation.reached).toHaveBeenCalled());
    const runId = useLaserStore.getState().activeRunId;
    simulator.yankCable();
    await vi.advanceTimersByTimeAsync(20);
    activation.release();
    await starting;
    expect(useUnarchivedRunStore.getState().openArtifact).toBeNull();
    expect(useUnarchivedRunStore.getState().completedRun).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(repository.getSnapshot().recoveryCapsule?.runId).toBe(runId);
    expect(repository.getSnapshot().recoveryCapsule?.artifact.kind).toBe('legacy-fingerprint-only');
  });

  it('does not replace a later run when an old activation failure resolves', async () => {
    const { repository, backend } = await prepareRun();
    const activation = delayFailedActivation(repository, backend);
    const starting = runStartJobFlow(repository);
    await vi.waitFor(() => expect(activation.reached).toHaveBeenCalled());
    const firstRunId = useLaserStore.getState().activeRunId;
    if (firstRunId === null) throw new Error('Expected accepted run.');
    await vi.advanceTimersByTimeAsync(5_000);
    await repository.cancelPendingStart(firstRunId);
    const later = await createCurrentTestExecutionArtifact({ runId: 'later-run' });
    await repository.stageArtifact(later);
    await repository.activateFreshRun(later.runId);
    useLaserStore.setState({
      activeRunId: later.runId,
      streamer: step(createStreamer(later.gcode)).state,
    });
    activation.release();
    await starting;
    expect(repository.getSnapshot().activeRun?.runId).toBe(later.runId);
    expect(useUnarchivedRunStore.getState().runId).toBeNull();
    expect(useUnarchivedRunStore.getState().completedRun).toBeNull();
  });

  it('preserves the first controller error while activation is delayed', async () => {
    const { repository, backend, onCompleted, simulator } = await prepareRun();
    const activation = delayFailedActivation(repository, backend);
    const starting = runStartJobFlow(repository);
    await vi.waitFor(() => expect(activation.reached).toHaveBeenCalled());
    const runId = useLaserStore.getState().activeRunId;
    const streamer = useLaserStore.getState().streamer;
    if (streamer === null) throw new Error('Expected a retained stream.');
    const rejectedLine = 'G1 X12.000 Y6.000 S300';
    useLaserStore.setState({
      streamer: { ...streamer, status: 'errored' },
      safetyNotice: {
        kind: 'controller-error',
        code: 20,
        rejectedLine,
        message: 'Rejected test line.',
      },
    });
    activation.release();
    await starting;
    expect(useUnarchivedRunStore.getState().openArtifact).toBeNull();
    expect(useUnarchivedRunStore.getState().completedRun).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(repository.getSnapshot().recoveryCapsule).toMatchObject({
      runId,
      interruption: { kind: 'controller-error', rejectedLine },
    });
    simulator.yankCable();
    await vi.advanceTimersByTimeAsync(20);
  });

  it.each([
    { ending: 'completed', rotary: false },
    { ending: 'completed', rotary: true },
    { ending: 'interrupted', rotary: false },
  ] as const)(
    'settles the $ending run after both archive writes fail, rotary=$rotary',
    async ({ ending, rotary }) => {
      const { repository, backend, simulator } = await prepareRun(rotary);
      const activation = delayFailedActivation(repository, backend);
      const note = repository.noteUntrackedRunAccepted.bind(repository);
      vi.spyOn(repository, 'noteUntrackedRunAccepted').mockImplementationOnce((...args) => {
        const mutate = backend.mutateSlots.bind(backend);
        vi.spyOn(backend, 'mutateSlots').mockImplementationOnce((mutation) => {
          backend.failNext('mutate-slots');
          return mutate(mutation);
        });
        return note(...args);
      });
      const starting = runStartJobFlow(repository);
      await vi.waitFor(() => expect(activation.reached).toHaveBeenCalled());
      const runId = useLaserStore.getState().activeRunId;
      const generation = repository.getSnapshot().generation;
      activation.release();
      await starting;
      expect(repository.getSnapshot().generation).toBe(generation);
      expect(repository.getSnapshot().pendingStart?.runId).toBe(runId);
      expect(useUnarchivedRunStore.getState().runId).toBe(runId);
      if (ending === 'completed') {
        await vi.advanceTimersByTimeAsync(5_000);
        // Advancing the simulated controller does not await the repository's
        // queued terminal writes or the completion offer that follows them.
        await vi.waitFor(
          () => {
            expect(useUnarchivedRunStore.getState().completedRun?.runId ?? null).toBe(
              rotary ? null : runId,
            );
            expect(repository.getSnapshot().pendingStart).toBeNull();
          },
          { timeout: 1_000, interval: 20 },
        );
        const framing = runFrameNow();
        await vi.advanceTimersByTimeAsync(12_000);
        expect(await framing).toBe(true);
        const nextStart = runStartJobFlow(repository);
        await vi.advanceTimersByTimeAsync(5_000);
        await nextStart;
        expect(repository.getSnapshot().lastCompletedReceipt?.runId).not.toBe(runId);
        expect(repository.getSnapshot().lastCompletedReceipt).not.toBeNull();
      } else {
        simulator.yankCable();
        await vi.advanceTimersByTimeAsync(20);
        expect(useUnarchivedRunStore.getState().completedRun).toBeNull();
        // The failed cleanup left its durable intent intact. It must not
        // manufacture a saved stop or erase that uncertain accepted run.
        expect(repository.getSnapshot().pendingStart?.runId).toBe(runId);
        expect(repository.getSnapshot().recoveryCapsule).toBeNull();
        await vi.advanceTimersByTimeAsync(11_000);
        await vi.waitFor(() => expect(repository.getSnapshot().pendingStart).toBeNull());
        expect(repository.getSnapshot().recoveryCapsule).toMatchObject({
          runId,
          interruption: { kind: 'unknown' },
        });
      }
    },
  );

  it('does not retain a rotary run when its archive activation fails', async () => {
    const { repository, onCompleted, fixture } = await prepareRun(true);
    const retention = observeFreshExecutionRetention('rotary-unarchived', repository);
    await activateAcceptedFreshRun(
      'rotary-unarchived',
      { staged: false, keep: () => fixture.source },
      repository,
      retention,
      fixture.prepared,
      () => undefined,
    );
    retention.stop();
    expect(useUnarchivedRunStore.getState().runId).toBe('rotary-unarchived');
    expect(useUnarchivedRunStore.getState().openArtifact).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('does not offer the flat-only editor for a completed rotary job', async () => {
    const project = createProject();
    const rotaryProject = {
      ...project,
      device: {
        ...project.device,
        rotary: {
          enabled: true,
          type: 'roller' as const,
          mmPerRotation: 100,
          objectDiameterMm: 40,
        },
      },
    };
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'audit-rotary',
      project: rotaryProject,
    });
    expect(
      rotaryAppliesTo(artifact.prepared.project.device, artifact.prepared.project.machine),
    ).toBe(true);
    expect(secondPassOfferable(artifact)).toBe(false);
  });
});
