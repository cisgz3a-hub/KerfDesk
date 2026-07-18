import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeJobMotionBounds, type JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import type { ReviewedStartBundle } from './job-review';
import { runFrameNow } from './use-frame-action';

const reviewHarness = vi.hoisted(() => ({
  runJobReviewGate: vi.fn(),
}));

vi.mock('./job-review', () => ({
  runJobReviewGate: reviewHarness.runJobReviewGate,
}));

type ReviewGateArgs = {
  readonly initial: ReviewedStartBundle;
  readonly checkpointToReplace: null;
  readonly completedReceipt: null;
  readonly purpose?: 'start' | 'frame';
};

const originalFrame = useLaserStore.getState().frame;
const originalSelectPrimaryWcsForFrame = useLaserStore.getState().selectPrimaryWcsForFrame;
const originalCapabilities = useLaserStore.getState().capabilities;
let reviewArgs: ReviewGateArgs | null;
let events: string[];

function installVectorProject(): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      scene: {
        ...EMPTY_SCENE,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'frame-contract.svg',
            bounds: { minX: 4, minY: 6, maxX: 24, maxY: 16 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 4, y: 6 },
                      { x: 24, y: 16 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
}

function dispatchedFrame(candidate: FramedRunCandidate): void {
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
}

function completeFrame(candidate: FramedRunCandidate): void {
  useLaserStore.setState((laser) => ({
    motionOperation: null,
    framedRun: createFramedRunPermit(candidate, laser),
    frameVerification: candidate.frameVerification,
  }));
}

beforeEach(() => {
  installVectorProject();
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  useLaserStore.setState({
    streamer: null,
    statusReport: idleControllerStatusForFrameTest(),
    alarmCode: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    workOriginActive: false,
    wcoCache: null,
    activeWcs: 'G54',
    homingState: 'unknown',
    trustedPositionEpoch: 3,
    framedRun: null,
    frameVerification: null,
  });
  useToastStore.setState({ toasts: [] });
  reviewArgs = null;
  events = [];
  reviewHarness.runJobReviewGate.mockReset().mockImplementation(async (args: ReviewGateArgs) => {
    reviewArgs = args;
    events.push('job-review');
    return {
      bundle: args.initial,
      laserModeStartEvidence: undefined,
      cncSetupAttestation: undefined,
    };
  });
});

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  useStore.getState().newProject();
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  useLaserStore.setState({
    frame: originalFrame,
    selectPrimaryWcsForFrame: originalSelectPrimaryWcsForFrame,
    capabilities: originalCapabilities,
    streamer: null,
    statusReport: null,
    alarmCode: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    framedRun: null,
    frameVerification: null,
  });
  vi.restoreAllMocks();
});

describe('runFrameNow framed-run authorization', () => {
  it.each(['g92-and-g10', 'g92-only'] as const)(
    'selects G54 for %s controllers and waits for its fresh position before review and Frame',
    async (wcs) => {
      const selectPrimaryWcsForFrame = vi.fn(async () => {
        events.push('select-g54');
        useLaserStore.setState({ activeWcs: 'G54', statusReport: null });
        setTimeout(() => {
          useLaserStore.setState((state) => ({
            statusSequence: state.statusSequence + 1,
            statusReport: idleControllerStatusForFrameTest(),
          }));
        }, 0);
      });
      const frame = vi.fn(
        async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
          if (candidate === undefined) throw new Error('Frame candidate was not supplied');
          events.push('physical-frame');
          dispatchedFrame(candidate);
          completeFrame(candidate);
        },
      );
      useLaserStore.setState((state) => ({
        activeWcs: 'G55',
        capabilities: { ...state.capabilities, wcs },
        selectPrimaryWcsForFrame,
        frame,
      }));

      await expect(runFrameNow()).resolves.toBe(true);

      expect(selectPrimaryWcsForFrame).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['select-g54', 'job-review', 'physical-frame']);
      expect(useLaserStore.getState().activeWcs).toBe('G54');
    },
  );

  it('reviews first, then dispatches the exact reviewed prepared artifact and motion envelope', async () => {
    let markReviewOpen: (() => void) | undefined;
    const reviewOpened = new Promise<void>((resolve) => {
      markReviewOpen = resolve;
    });
    let confirmReview: (() => void) | undefined;
    reviewHarness.runJobReviewGate.mockImplementation((args: ReviewGateArgs) => {
      reviewArgs = args;
      events.push('job-review');
      markReviewOpen?.();
      return new Promise((resolve) => {
        confirmReview = () =>
          resolve({
            bundle: args.initial,
            laserModeStartEvidence: undefined,
            cncSetupAttestation: undefined,
          });
      });
    });
    const frame = vi.fn(async (bounds: JobBounds, feed: number, candidate?: FramedRunCandidate) => {
      events.push('physical-frame');
      if (candidate === undefined) throw new Error('Frame candidate was not supplied');
      const reviewed = reviewArgs?.initial;
      if (reviewed === undefined) throw new Error('Frame ran before Job Review');

      expect(candidate.preparedStart).toBe(reviewed.prepared);
      expect(candidate.project).toBe(reviewed.project);
      expect(candidate.executionSignature).toBe(reviewed.prepared.canvasPlan.retentionKey);
      expect(bounds).toEqual(
        computeJobMotionBounds(reviewed.prepared.prepared.job, reviewed.project.device),
      );
      expect(feed).toBe(reviewed.project.device.framingFeedMmPerMin);

      dispatchedFrame(candidate);
      completeFrame(candidate);
    });
    useLaserStore.setState({ frame });

    const outcome = runFrameNow();
    await reviewOpened;
    expect(frame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().motionOperation).toBeNull();

    confirmReview?.();
    await expect(outcome).resolves.toBe(true);

    expect(events).toEqual(['job-review', 'physical-frame']);
    expect(reviewArgs).toMatchObject({
      checkpointToReplace: null,
      completedReceipt: null,
      purpose: 'frame',
    });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().framedRun?.candidate.preparedStart).toBe(
      reviewArgs?.initial.prepared,
    );
  });

  it('stays pending after dispatch and resolves true only when completion publishes its permit', async () => {
    let markDispatched: (() => void) | undefined;
    const dispatchObserved = new Promise<void>((resolve) => {
      markDispatched = resolve;
    });
    let dispatchedCandidate: FramedRunCandidate | undefined;
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        dispatchedCandidate = candidate;
        dispatchedFrame(candidate);
        markDispatched?.();
      },
    );
    useLaserStore.setState({ frame });

    let settled = false;
    const outcome = runFrameNow();
    void outcome.then(() => {
      settled = true;
    });
    await dispatchObserved;
    await Promise.resolve();

    expect(useLaserStore.getState().motionOperation?.kind).toBe('frame');
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(settled).toBe(false);

    if (dispatchedCandidate === undefined) throw new Error('Frame was not dispatched');
    completeFrame(dispatchedCandidate);

    await expect(outcome).resolves.toBe(true);
    expect(settled).toBe(true);
    expect(useLaserStore.getState().framedRun?.candidate).toBe(dispatchedCandidate);
  });

  it('resolves false when an owned Frame is cancelled while its safety lock remains', async () => {
    let markDispatched: (() => void) | undefined;
    const dispatchObserved = new Promise<void>((resolve) => {
      markDispatched = resolve;
    });
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        dispatchedFrame(candidate);
        markDispatched?.();
      },
    );
    useLaserStore.setState({ frame });

    const outcome = runFrameNow();
    await dispatchObserved;
    useLaserStore.setState((state) => ({
      motionOperation:
        state.motionOperation?.kind === 'frame'
          ? { ...state.motionOperation, cancelRequested: true }
          : state.motionOperation,
    }));

    await expect(outcome).resolves.toBe(false);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('returns false and creates no permit when the controller accepts no Frame dispatch', async () => {
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(frame).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'error',
      message: expect.stringContaining('did not dispatch framing motion'),
    });
  });

  it('returns false and creates no permit when physical Frame dispatch fails', async () => {
    const frame = vi.fn(async () => {
      throw new Error('serial write failed');
    });
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(frame).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'error',
      message: 'serial write failed',
    });
  });

  it('expires a permit permanently on the first project or environment drift', async () => {
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        dispatchedFrame(candidate);
        completeFrame(candidate);
      },
    );
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);
    const originalProject = useStore.getState().project;
    expect(useLaserStore.getState().framedRun).not.toBeNull();

    useStore.setState({
      project: {
        ...originalProject,
        device: { ...originalProject.device, bedWidth: originalProject.device.bedWidth + 1 },
      },
    });
    useStore.setState({ project: originalProject });
    expect(useLaserStore.getState().framedRun).toBeNull();

    await expect(runFrameNow()).resolves.toBe(true);
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    useCameraStore.getState().setSurfaceHeightMm(12);
    useCameraStore.getState().setSurfaceHeightMm(0);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('expires permanently when rotary feature identity changes away and back', async () => {
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: {
          ...project.device,
          capabilities: [...(project.device.capabilities ?? []), 'rotary'],
        },
      },
    });
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        dispatchedFrame(candidate);
        completeFrame(candidate);
      },
    );
    useLaserStore.setState({ frame });
    await expect(runFrameNow()).resolves.toBe(true);

    useExperimentalLaserFeatures.getState().setFeature('rotaryRaster', true);
    useExperimentalLaserFeatures.getState().setFeature('rotaryRaster', false);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('expires permanently when print-and-cut registration changes away and back', async () => {
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
      },
    });
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    usePrintCutSessionStore.getState().capture('first', { x: 0, y: 0 }, 3);
    usePrintCutSessionStore.getState().capture('second', { x: 10, y: 0 }, 3);
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        dispatchedFrame(candidate);
        completeFrame(candidate);
      },
    );
    useLaserStore.setState({ frame });
    await expect(runFrameNow()).resolves.toBe(true);

    usePrintCutSessionStore.getState().capture('first', { x: 1, y: 0 }, 3);
    usePrintCutSessionStore.getState().capture('first', { x: 0, y: 0 }, 3);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });
});
