import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobBounds } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import type { ConfirmedJobReview, ReviewedStartBundle } from './job-review';
import { buildJobReviewModel } from './job-review/job-review-model';
import { dispatchTransientReviewedFrame, runFrameNow } from './use-frame-action';

const reviewHarness = vi.hoisted(() => ({
  runJobReviewGate: vi.fn(),
}));

vi.mock('./job-review', () => ({
  runJobReviewGate: reviewHarness.runJobReviewGate,
}));

const originalFrame = useLaserStore.getState().frame;
const originalSelectPrimaryWcsForFrame = useLaserStore.getState().selectPrimaryWcsForFrame;
const originalCapabilities = useLaserStore.getState().capabilities;

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
            source: 'transient-frame-contract.svg',
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

function completePhysicalFrame(candidate: FramedRunCandidate): void {
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
  reviewHarness.runJobReviewGate.mockReset();
});

afterEach(() => {
  useStore.getState().newProject();
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

describe('transient reviewed Frame dispatch', () => {
  it('physically Frames the immutable project and returns its exact completion permit', async () => {
    // ADR-237: plain Frame no longer opens Job Review, so capture the exact
    // prepared artifact from a dispatch-only Frame attempt instead.
    let captured: FramedRunCandidate | undefined;
    const captureOnlyFrame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        captured = candidate;
      },
    );
    useLaserStore.setState({ frame: captureOnlyFrame });
    await expect(runFrameNow()).resolves.toBe(false);
    expect(reviewHarness.runJobReviewGate).not.toHaveBeenCalled();
    if (captured === undefined) throw new Error('Transient prepared artifact was not captured');
    const transientBundle: ReviewedStartBundle = {
      app: useStore.getState(),
      project: captured.project,
      laser: useLaserStore.getState(),
      prepared: captured.preparedStart,
      laserModeStartSnapshot: captureLaserModeStartSnapshot(useLaserStore.getState()),
      externalEnvironment: captured.externalEnvironment,
    };

    const review: ConfirmedJobReview = {
      bundle: transientBundle,
      reviewedAtIso: '2026-07-19T12:00:00.000Z',
      reviewModel: buildJobReviewModel({
        project: transientBundle.project,
        prepared: transientBundle.prepared,
        laserModeStartSnapshot: transientBundle.laserModeStartSnapshot,
        overrides: transientBundle.laser.ovCache,
      }),
      laserModeStartEvidence: undefined,
      cncSetupAttestation: undefined,
    };
    useStore.setState({ project: createProject() });
    expect(useStore.getState().project).not.toBe(transientBundle.project);

    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        completePhysicalFrame(candidate);
      },
    );
    useLaserStore.setState({ frame });

    const permit = await dispatchTransientReviewedFrame(review, DEFAULT_OUTPUT_SCOPE);

    expect(frame).toHaveBeenCalledTimes(1);
    expect(permit).toBe(useLaserStore.getState().framedRun);
    expect(permit?.candidate).toMatchObject({
      authorizationContext: 'transient-camera',
      outputScope: DEFAULT_OUTPUT_SCOPE,
    });
    expect(permit?.candidate.project).toBe(transientBundle.project);
    expect(permit?.candidate.preparedStart).toBe(transientBundle.prepared);
  });
});
