import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLaserSecondPassProgram } from '../../core/laser-second-pass';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import type { JobOriginPlacement } from '../../core/job';
import { createProject } from '../../core/scene';
import { fingerprintGcode } from '../../core/recovery';
import { useStore } from '../state';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { JobStartTransmissionError } from '../state/laser-start-transmission-error';
import { RecoveryRepository, type ExecutionArtifactV1 } from '../state/recovery';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import {
  captureJobReviewModels,
  installAutoJobReview,
  useJobReviewStore,
  type JobReviewModel,
} from './job-review';
import { recoveryArtifactPreparedProgramMatches } from './recovery-artifact-binding';
import * as recoveryBinding from './recovery-artifact-binding';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import {
  CANVAS_FRAME_REPLACED_MESSAGE,
  frameLaserSecondPass,
  invalidateLaserSecondPassFrame,
  startLaserSecondPass,
} from './second-pass-execution';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';
import { registerVerifiedLaserSecondPassPreparation } from './second-pass-preparation-proof';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalFrame = useLaserStore.getState().frame;
const originalStart = useLaserStore.getState().startJob;
let uninstallReview = (): void => undefined;
let repository: RecoveryRepository;

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: 7,
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    statusReport: idleControllerStatusForFrameTest(),
    activeWcs: 'G54',
    startJob: vi.fn(async (_gcode, options) => {
      options?.assertFinalStartAuthorized?.();
    }),
    frame: vi.fn(async (_bounds, _feed, candidate) => {
      if (candidate === undefined) throw new Error('Expected exact candidate.');
      completeTestFrame(candidate);
    }),
  });
  repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
});

afterEach(() => {
  uninstallReview();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), frame: originalFrame, startJob: originalStart });
  resetStore();
  vi.restoreAllMocks();
});

function completeTestFrame(candidate: FramedRunCandidate): void {
  useLaserStore.setState({
    motionOperation: {
      operationId: 1,
      kind: 'frame',
      candidate,
      sawControllerBusy: false,
      idleStatusReports: 0,
      dispatchComplete: true,
      pendingLines: [],
    },
  });
  useLaserStore.setState((laser) => ({
    motionOperation: null,
    framedRun: createFramedRunPermit(candidate, laser),
    frameVerification: candidate.frameVerification,
  }));
}

function activeExactArtifact(): ExecutionArtifactV1 {
  const artifact = repository.getSnapshot().activeRun?.artifact;
  if (artifact?.kind !== 'exact-execution') throw new Error('Expected tracked exact artifact.');
  return artifact;
}

function expectPaintedReview(model: JobReviewModel | undefined): void {
  if (model === undefined) throw new Error('Expected a second-pass Job Review.');
  expect(model.stats.find((tile) => tile.label === 'Output scope')?.value).toBe(
    'Painted areas only',
  );
  expect(model.stats.find((tile) => tile.label === 'Painted power')?.value).toBe(
    '120% of original',
  );
  expect(
    model.stats.some((tile) => tile.label === 'Operations' || tile.label === 'Fill runway'),
  ).toBe(false);
  expect(model.effectiveOperations).toEqual([]);
}

function sourceFixture(origin?: JobOriginPlacement) {
  return createSecondPassExecutionFixture(repository, origin);
}

describe('exact second-pass Frame and Start ownership', () => {
  it.each([false, true])(
    'uses the verified worker result and captured bounds without recompiling, native mapping known=%s',
    async (known) => {
      const baseDevice = createProject().device;
      const device = { ...baseDevice, homing: { ...baseDevice.homing, enabled: true } };
      if (known) useLaserStore.setState(stockNativeEvidence(device, true));
      const fixture = await createSecondPassExecutionFixture(repository, undefined, device);
      const expectedBounds = structuredClone(fixture.prepared.metrics.frameMotionBounds);
      const requalify = vi.fn(async (initialPosition: { x: number; y: number; z: number }) => ({
        manifest: buildMotionManifest(fixture.prepared.gcode, {
          machineKind: 'laser',
          initialPosition,
        }),
        duration: fixture.prepared.metrics.duration,
      }));
      registerVerifiedLaserSecondPassPreparation(
        fixture.source,
        fixture.prepared,
        fixture.selection,
        requalify,
      );
      useLaserStore.setState({
        workOriginActive: true,
        wcoCache: { x: 10, y: 20, z: 0 },
        trustedPositionEpoch: 18,
      });
      const binding = vi
        .spyOn(recoveryBinding, 'recoveryArtifactPreparedOutput')
        .mockImplementation(() => {
          throw new Error('The UI must not synchronously repeat worker compilation.');
        });
      Object.assign(fixture.prepared.metrics, {
        frameMotionBounds: { minX: 900, minY: 900, maxX: 901, maxY: 901 },
      });
      const permit = await frameLaserSecondPass(
        fixture.source,
        fixture.prepared,
        fixture.selection,
      );
      expect(permit).not.toBeNull();
      expect(binding).not.toHaveBeenCalled();
      expect(vi.mocked(useLaserStore.getState().frame).mock.calls[0]?.[0]).toEqual(expectedBounds);
      expect(requalify).toHaveBeenCalledWith({ x: 21, y: 22, z: 0 });
      const plan = permit?.candidate.preparedStart.canvasPlan;
      expect(plan?.coordinateFrame).toEqual(
        known
          ? {
              kind: 'machine',
              workOffsetMm: { x: 10, y: 20, z: 0 },
              nativeToBedOffsetMm: { x: 0, y: 0 },
            }
          : { kind: 'relative', jobOriginOffset: fixture.source.prepared.jobOriginOffset },
      );
      expect(plan?.positionEpoch).toBe(18);
      expect(plan?.capability).toBe('realtime');
    },
  );

  it('Frames only the clipped immutable program, then starts and archives it after review', async () => {
    const fixture = await sourceFixture();
    // A retained completed-history choice survives expiration of the current
    // replay offer; the immutable source and exact Frame own this new job.
    await repository.discardCompletedReceipt(fixture.source.runId);
    const openProject = useStore.getState().project;
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    expect(permit?.candidate.authorizationContext).toBe('laser-second-pass');
    expect(permit?.candidate.review).toBeUndefined();
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(openProject);
    if (permit === null) throw new Error('Expected physical Frame permit.');
    expect(permit.candidate.preparedStart.gcode).toBe(fixture.prepared.gcode);
    uninstallReview = installAutoJobReview('confirm');
    const review = captureJobReviewModels();
    await expect(startLaserSecondPass(permit, repository)).resolves.toBe(true);
    review.stop();
    expectPaintedReview(review.models.at(-1));
    const calls = vi.mocked(useLaserStore.getState().startJob).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(fixture.prepared.gcode);
    expect(calls[0]?.[1]?.framedRunPermit).toBe(permit);
    const artifact = activeExactArtifact();
    expect(artifact.laserSecondPassChain?.[0]?.selection).toEqual(fixture.selection);
    expect(artifact.provenance?.schemaVersion === 2 && artifact.provenance.workflow.kind).toBe(
      'laser-second-pass',
    );
    expect(recoveryArtifactPreparedProgramMatches(artifact)).toBe(true);
    await expect(executionArtifactIntegrityIsValid(artifact)).resolves.toBe(true);
  });

  it('keeps cancel and duplicate Start from dispatching a second program', async () => {
    const fixture = await sourceFixture();
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    if (permit === null) throw new Error('Expected permit.');
    uninstallReview = installAutoJobReview('cancel');
    await expect(startLaserSecondPass(permit, repository)).resolves.toBe(false);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe(fixture.source.runId);
    uninstallReview();
    uninstallReview = installAutoJobReview('confirm');
    const results = await Promise.all([
      startLaserSecondPass(permit, repository),
      startLaserSecondPass(permit, repository),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
  });

  it('refuses controller movement while the worker binds the Frame approach', async () => {
    const fixture = await sourceFixture();
    registerVerifiedLaserSecondPassPreparation(
      fixture.source,
      fixture.prepared,
      fixture.selection,
      async () => {
        useLaserStore.setState((state) => ({
          trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
        }));
        return {
          manifest: fixture.prepared.canvasPlan.manifest,
          duration: fixture.prepared.metrics.duration,
        };
      },
    );
    await expect(
      frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection),
    ).resolves.toBeNull();
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
  });

  it('keeps the original current-position placement when framing from a different head position', async () => {
    const origin = {
      startFrom: 'current-position' as const,
      anchor: 'front-left' as const,
      currentPosition: { x: 31, y: 42 },
    };
    const fixture = await sourceFixture(origin);
    useLaserStore.setState({
      statusReport: { ...idleControllerStatusForFrameTest(), mPos: { x: 91, y: 92, z: 0 } },
    });
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    if (permit === null) throw new Error('Expected frozen current-position permit.');
    expect(permit.candidate.preparedStart.gcode).toBe(fixture.prepared.gcode);
    expect(permit.candidate.preparedStart.jobOrigin).toEqual(origin);
    expect(permit.candidate.preparedStart.canvasPlan.coordinateFrame).toEqual({
      kind: 'relative',
      jobOriginOffset: fixture.source.prepared.jobOriginOffset,
    });
    expect(permit.candidate.returnToWorkPosition).toEqual({ x: 91, y: 92 });
  });

  it('refuses a revoked permit across the durable handoff and leaves no transmitted job', async () => {
    const fixture = await sourceFixture();
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    if (permit === null) throw new Error('Expected permit.');
    uninstallReview = installAutoJobReview('confirm');
    const arm = repository.armFreshStartIntent.bind(repository);
    vi.spyOn(repository, 'armFreshStartIntent').mockImplementationOnce(async (...args) => {
      const result = await arm(...args);
      invalidateLaserSecondPassFrame(permit);
      return result;
    });
    await expect(startLaserSecondPass(permit, repository)).resolves.toBe(false);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe(fixture.source.runId);
  });

  it('retains the attempted second-pass archive when its first write may have reached the controller', async () => {
    const fixture = await sourceFixture();
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    if (permit === null) throw new Error('Expected permit.');
    uninstallReview = installAutoJobReview('confirm');
    useLaserStore.setState({
      startJob: vi.fn(async (_gcode, options) => {
        options?.assertFinalStartAuthorized?.();
        throw new JobStartTransmissionError(
          new Error('Cable write failed'),
          options?.runId ?? null,
          2,
        );
      }),
    });
    await expect(startLaserSecondPass(permit, repository)).resolves.toBe(false);
    const capsule = repository.getSnapshot().recoveryCapsule;
    expect(capsule?.runId).not.toBe(fixture.source.runId);
    expect(capsule?.ackedLines).toBe(2);
    expect(capsule?.artifact.kind === 'exact-execution' && capsule.artifact.gcode).toBe(
      fixture.prepared.gcode,
    );
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  });

  it('refuses changed preview bytes and only revokes the exact owned permit on cancellation', async () => {
    const fixture = await sourceFixture();
    await expect(
      frameLaserSecondPass(fixture.source, { ...fixture.prepared, gcode: 'M5' }, fixture.selection),
    ).resolves.toBeNull();
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    if (permit === null) throw new Error('Expected permit.');
    const successor = { ...permit };
    useLaserStore.setState({ framedRun: successor });
    invalidateLaserSecondPassFrame(permit);
    expect(useLaserStore.getState().framedRun).toBe(successor);
    invalidateLaserSecondPassFrame(successor);
    await expect(startLaserSecondPass(successor, repository)).resolves.toBe(false);
  });

  it('tells the operator when the second-pass Frame replaces an armed canvas Frame', async () => {
    const fixture = await sourceFixture();
    useToastStore.setState({ toasts: [] });
    const messages = () => useToastStore.getState().toasts.map((toast) => toast.message);
    const first = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    expect(first).not.toBeNull();
    expect(messages()).not.toContain(CANVAS_FRAME_REPLACED_MESSAGE);
    // An ordinary canvas permit has no authorization context and is signed by
    // the live canvas, which keeps the invalidation subscription from expiring it.
    const ordinary = {
      ...first,
      candidate: {
        ...first?.candidate,
        authorizationContext: undefined,
        executionSignature: currentReplayExecutionSignature(),
      },
    } as unknown as NonNullable<typeof first>;
    useLaserStore.setState({ framedRun: ordinary });
    const second = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    expect(second).not.toBeNull();
    expect(useLaserStore.getState().framedRun).toBe(second);
    expect(messages()).toContain(CANVAS_FRAME_REPLACED_MESSAGE);
    // Its own permit is only its own: replacing it again stays quiet.
    useToastStore.setState({ toasts: [] });
    await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    expect(messages()).not.toContain(CANVAS_FRAME_REPLACED_MESSAGE);
  });

  it('preserves transform ordering through disconnect recovery and another selected pass', async () => {
    const fixture = await sourceFixture();
    uninstallReview = installAutoJobReview('confirm');
    const permit = await frameLaserSecondPass(fixture.source, fixture.prepared, fixture.selection);
    if (permit === null) throw new Error('Expected permit.');
    await expect(startLaserSecondPass(permit, repository)).resolves.toBe(true);
    const first = activeExactArtifact();
    await repository.interruptRun(first.runId, 2, { kind: 'disconnect', message: 'Disconnected.' });
    const capsule = repository.getSnapshot().recoveryCapsule;
    if (capsule === null) throw new Error('Expected interrupted pass.');
    await expect(runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine: 1 })).resolves.toBe(
      true,
    );
    const recovered = activeExactArtifact();
    expect(recovered.laserResumeChain).toEqual([{ fromLine: 1, version: 2 }]);
    expect(recovered.laserSecondPassChain).toHaveLength(1);
    expect(recoveryArtifactPreparedProgramMatches(recovered)).toBe(true);
    await expect(executionArtifactIntegrityIsValid(recovered)).resolves.toBe(true);
    await repository.completeRun(recovered.runId);
    const clipped = buildLaserSecondPassProgram(recovered.gcode, fixture.selection);
    if (clipped.kind === 'error') throw new Error(clipped.message);
    const nextPrepared = {
      ...fixture.prepared,
      gcode: clipped.gcode,
      canvasPlan: {
        ...fixture.prepared.canvasPlan,
        fingerprint: fingerprintGcode(clipped.gcode),
        manifest: buildMotionManifest(clipped.gcode, { machineKind: 'laser' }),
      },
    };
    const next = await frameLaserSecondPass(recovered, nextPrepared, fixture.selection);
    if (next === null) throw new Error('Expected repeated-pass permit.');
    await expect(startLaserSecondPass(next, repository)).resolves.toBe(true);
    const artifact = activeExactArtifact();
    expect(artifact.laserSecondPassChain).toHaveLength(2);
    // Each saved step names the transform and writer that built its bytes.
    expect(artifact.laserSecondPassChain?.[1]?.resumeChainBefore).toEqual([
      { fromLine: 1, version: 2 },
    ]);
    expect(artifact.laserSecondPassChain?.map((stage) => stage.writerVersion)).toEqual([2, 2]);
    expect(artifact.laserResumeChain).toBeUndefined();
    expect(recoveryArtifactPreparedProgramMatches(artifact)).toBe(true);
    await expect(executionArtifactIntegrityIsValid(artifact)).resolves.toBe(true);
    const changed = structuredClone(artifact);
    const stroke = changed.laserSecondPassChain?.[0]?.selection.strokes[0];
    if (stroke === undefined) throw new Error('Expected brush provenance.');
    Object.assign(stroke, { powerScale: 1.9 });
    await expect(executionArtifactIntegrityIsValid(changed)).resolves.toBe(false);
    expect(recoveryArtifactPreparedProgramMatches(changed)).toBe(false);
  });
});
