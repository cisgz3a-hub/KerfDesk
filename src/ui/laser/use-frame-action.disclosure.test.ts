import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import type { ReviewedStartBundle } from './job-review';
import { useStartBlockerStore } from './start-blocker-store';
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

function expectedWcsNormalizationWarning(wcs: 'G55' | 'G56' | 'G57' | 'G58' | 'G59'): string {
  return (
    `Controller was using ${wcs}. KerfDesk selected G54 because both this physical Frame and the ` +
    `reviewed program run in G54. Your ${wcs} offset was not erased, and neither was any other ` +
    'G54-G59 offset. If you cancel, G54 remains selected.'
  );
}

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
            source: 'frame-disclosure.svg',
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

function successfulFrame(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
    if (candidate === undefined) throw new Error('Frame candidate was not supplied');
    dispatchedFrame(candidate);
    completeFrame(candidate);
  });
}

function selectG54WithFreshIdle(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    useLaserStore.setState({ activeWcs: 'G54', statusReport: null });
    setTimeout(() => {
      useLaserStore.setState((state) => ({
        statusSequence: state.statusSequence + 1,
        statusReport: idleControllerStatusForFrameTest(),
      }));
    }, 0);
  });
}

beforeEach(() => {
  installVectorProject();
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
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
  useStartBlockerStore.getState().clear();
  reviewHarness.runJobReviewGate.mockReset().mockImplementation(async (args: ReviewGateArgs) => {
    return {
      bundle: args.initial,
      laserModeStartEvidence: undefined,
      cncSetupAttestation: undefined,
    };
  });
});

afterEach(() => {
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

describe('Frame WCS disclosure and completion reporting', () => {
  it.each(['G55', 'G56', 'G57', 'G58', 'G59'] as const)(
    'retains the owned normalization from %s on the permit for the Start review',
    async (originalWcs) => {
      const selectPrimaryWcsForFrame = selectG54WithFreshIdle();
      useLaserStore.setState({
        activeWcs: originalWcs,
        selectPrimaryWcsForFrame,
        frame: successfulFrame(),
      });

      await expect(runFrameNow()).resolves.toBe(true);

      expect(selectPrimaryWcsForFrame).toHaveBeenCalledTimes(1);
      // ADR-237: Frame runs dialog-free; the disclosure rides the permit
      // into the Job Review that Start opens.
      expect(reviewHarness.runJobReviewGate).not.toHaveBeenCalled();
      expect(useLaserStore.getState().framedRun?.candidate.frameWcsNormalizationWarning).toBe(
        expectedWcsNormalizationWarning(originalWcs),
      );
    },
  );

  it('does not write or add a normalization warning when G54 is already active', async () => {
    const selectPrimaryWcsForFrame = vi.fn(async () => undefined);
    useLaserStore.setState({
      activeWcs: 'G54',
      selectPrimaryWcsForFrame,
      frame: successfulFrame(),
    });

    await expect(runFrameNow()).resolves.toBe(true);

    expect(selectPrimaryWcsForFrame).not.toHaveBeenCalled();
    expect(
      useLaserStore.getState().framedRun?.candidate.frameWcsNormalizationWarning,
    ).toBeUndefined();
  });

  it('normalizes an unknown WCS without inventing a named-offset warning', async () => {
    const selectPrimaryWcsForFrame = selectG54WithFreshIdle();
    useLaserStore.setState({
      activeWcs: null,
      selectPrimaryWcsForFrame,
      frame: successfulFrame(),
    });

    await expect(runFrameNow()).resolves.toBe(true);

    expect(selectPrimaryWcsForFrame).toHaveBeenCalledTimes(1);
    expect(
      useLaserStore.getState().framedRun?.candidate.frameWcsNormalizationWarning,
    ).toBeUndefined();
  });

  it('retains the G54 disclosure when later placement preparation fails', async () => {
    const warning = expectedWcsNormalizationWarning('G55');
    const selectPrimaryWcsForFrame = selectG54WithFreshIdle();
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
    useLaserStore.setState({
      activeWcs: 'G55',
      workOriginActive: false,
      selectPrimaryWcsForFrame,
      frame: successfulFrame(),
    });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(reviewHarness.runJobReviewGate).not.toHaveBeenCalled();
    expect(useStartBlockerStore.getState().messages).toContain(warning);
    expect(useLaserStore.getState().activeWcs).toBe('G54');
  });

  it('retains the G54 disclosure when no fresh post-selection position arrives', async () => {
    vi.useFakeTimers();
    try {
      const warning = expectedWcsNormalizationWarning('G55');
      const selectPrimaryWcsForFrame = vi.fn(async () => {
        useLaserStore.setState({ activeWcs: 'G54', statusReport: null });
      });
      useLaserStore.setState({
        activeWcs: 'G55',
        selectPrimaryWcsForFrame,
        frame: successfulFrame(),
      });

      const outcome = runFrameNow();
      await vi.advanceTimersByTimeAsync(3_100);
      await expect(outcome).resolves.toBe(false);

      expect(reviewHarness.runJobReviewGate).not.toHaveBeenCalled();
      expect(useStartBlockerStore.getState().messages).toContain(warning);
      expect(useLaserStore.getState().activeWcs).toBe('G54');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns false when the completed permit is invalidated before success is reported', async () => {
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

    const outcome = runFrameNow();
    await dispatchObserved;
    await Promise.resolve();
    if (dispatchedCandidate === undefined) throw new Error('Frame was not dispatched');
    completeFrame(dispatchedCandidate);
    useLaserStore.setState({ framedRun: null, frameVerification: null });

    await expect(outcome).resolves.toBe(false);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: expect.stringContaining('Frame completed, but the job or machine setup changed'),
    });
  });
});
