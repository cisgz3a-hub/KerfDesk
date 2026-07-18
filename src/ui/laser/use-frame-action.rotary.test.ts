import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RotaryType } from '../../core/devices';
import {
  computeJobBounds,
  computeJobMotionBounds,
  frameBoundsSignature,
  machineSpaceJob,
  type JobBounds,
} from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useToastStore } from '../state/toast-store';
import type { ReviewedStartBundle } from './job-review';
import { runFrameNow } from './use-frame-action';

const reviewHarness = vi.hoisted(() => ({ runJobReviewGate: vi.fn() }));

vi.mock('./job-review', () => ({ runJobReviewGate: reviewHarness.runJobReviewGate }));

type ReviewGateArgs = {
  readonly initial: ReviewedStartBundle;
};

const originalFrame = useLaserStore.getState().frame;

function installRotaryVectorProject(type: RotaryType): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      device: {
        ...base.device,
        rotary: { enabled: true, type, mmPerRotation: 360, objectDiameterMm: 60 },
      },
      scene: {
        ...EMPTY_SCENE,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'rotary-frame-contract.svg',
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

function idleStatus() {
  return {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 31, y: 42, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

function completeFrame(candidate: FramedRunCandidate): void {
  useLaserStore.setState((laser) => ({
    motionOperation: null,
    framedRun: createFramedRunPermit(candidate, laser),
    frameVerification: candidate.frameVerification,
  }));
}

beforeEach(() => {
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  useLaserStore.setState({
    streamer: null,
    statusReport: idleStatus(),
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
  reviewHarness.runJobReviewGate.mockReset().mockImplementation(async (args: ReviewGateArgs) => ({
    bundle: args.initial,
    laserModeStartEvidence: undefined,
    cncSetupAttestation: undefined,
  }));
});

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    frame: originalFrame,
    statusReport: null,
    motionOperation: null,
    framedRun: null,
    frameVerification: null,
  });
  vi.restoreAllMocks();
});

describe('runFrameNow rotary machine-space contract', () => {
  it.each([
    { type: 'roller' as const, expectedMaxY: 10, expectedSignature: '4,0,24,10' },
    {
      type: 'chuck' as const,
      expectedMaxY: 3600 / (Math.PI * 60),
      expectedSignature: '4,0,24,19.099',
    },
  ])(
    'frames the scaled and rebased G-code envelope for an active $type rotary',
    async ({ type, expectedMaxY, expectedSignature }) => {
      installRotaryVectorProject(type);
      const frame = vi.fn(
        async (bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
          if (candidate === undefined) throw new Error('Frame candidate was not supplied');
          const prepared = candidate.preparedStart.prepared;
          const machineJob = machineSpaceJob(
            prepared.job,
            prepared.project.device,
            prepared.project.machine,
          );
          const burnBounds = computeJobBounds(machineJob, prepared.project.device);
          const motionBounds = computeJobMotionBounds(machineJob, prepared.project.device);
          if (burnBounds === null || motionBounds === null) {
            throw new Error('Expected rotary machine-space bounds');
          }

          expect(bounds).toEqual(motionBounds);
          expect(bounds.minY).toBeCloseTo(0, 6);
          expect(bounds.maxY).toBeCloseTo(expectedMaxY, 6);
          expect(candidate.frameVerification.boundsSignature).toBe(expectedSignature);
          expect(candidate.frameVerification.boundsSignature).toBe(
            frameBoundsSignature(burnBounds),
          );
          expect(candidate.preparedStart.gcode).toContain('X24.000 Y0.000');
          expect(candidate.preparedStart.gcode).toContain(`X4.000 Y${expectedMaxY.toFixed(3)}`);

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
          completeFrame(candidate);
        },
      );
      useLaserStore.setState({ frame });

      const accepted = await runFrameNow();
      expect(accepted, useToastStore.getState().toasts.at(-1)?.message).toBe(true);
      expect(frame).toHaveBeenCalledTimes(1);
    },
  );
});
