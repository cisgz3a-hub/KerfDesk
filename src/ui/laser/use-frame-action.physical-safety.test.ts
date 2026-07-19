import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeJobMotionBounds, machineSpaceJob, type JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import type { FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  completeFramedRunCandidateForTest,
  idleControllerStatusForFrameTest,
} from './framed-run-testing';
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
};

const originalFrame = useLaserStore.getState().frame;
const originalSelectPrimaryWcsForFrame = useLaserStore.getState().selectPrimaryWcsForFrame;
const originalCapabilities = useLaserStore.getState().capabilities;

function installVectorProject(bounds: JobBounds): void {
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
            id: 'frame-safety-object',
            source: 'frame-safety.svg',
            bounds,
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: bounds.minX, y: bounds.minY },
                      { x: bounds.maxX, y: bounds.maxY },
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

function currentMotionBounds(): JobBounds {
  const project = useStore.getState().project;
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected the test project to prepare.');
  const job = machineSpaceJob(prepared.job, project.device, project.machine);
  const bounds = computeJobMotionBounds(job, project.device);
  if (bounds === null) throw new Error('Expected non-empty motion bounds.');
  return bounds;
}

function setNoGoZone(zone: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        noGoZones: [{ id: 'clamp', name: 'Clamp', enabled: true, ...zone }],
      },
    },
  });
}

function completingFrame() {
  return vi.fn(async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
    if (candidate === undefined) throw new Error('Frame candidate was not supplied.');
    completeFramedRunCandidateForTest(candidate);
  });
}

beforeEach(() => {
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
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
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
    selectPrimaryWcsForFrame: originalSelectPrimaryWcsForFrame,
    capabilities: originalCapabilities,
    streamer: null,
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    framedRun: null,
    frameVerification: null,
  });
  vi.restoreAllMocks();
});

describe('Frame source-of-truth contract', () => {
  it.each([
    [{ maxPowerS: 255, laserModeEnabled: true }, '$30'],
    [{ maxPowerS: 1000, laserModeEnabled: false }, '$32=0'],
  ] as const)(
    'keeps known-wrong live setting %o in review and lets Frame decide',
    async (settings, label) => {
      installVectorProject({ minX: 40, minY: 40, maxX: 100, maxY: 100 });
      const frame = completingFrame();
      useLaserStore.setState({ controllerSettings: settings, frame });

      await expect(runFrameNow()).resolves.toBe(true);

      expect(reviewHarness.runJobReviewGate).toHaveBeenCalledOnce();
      expect(frame).toHaveBeenCalledOnce();
      expect(useLaserStore.getState().framedRun).not.toBeNull();
      expect(JSON.stringify(reviewHarness.runJobReviewGate.mock.calls[0])).toContain(label);
    },
  );

  it('frames when calculated artwork bounds extend beyond the configured bed', async () => {
    installVectorProject({ minX: 390, minY: 10, maxX: 410, maxY: 20 });
    const frame = completingFrame();
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);

    expect(frame).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('success');
  });

  it('does not turn a trusted work offset into a calculated bed veto', async () => {
    installVectorProject({ minX: 40, minY: 40, maxX: 50, maxY: 50 });
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
      },
      jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
    });
    useLaserStore.setState({
      statusReport: {
        ...idleControllerStatusForFrameTest(),
        mPos: { x: 395, y: 100, z: 0 },
        wPos: { x: 385, y: 100, z: 0 },
        wco: { x: 10, y: 0, z: 0 },
      },
      wcoCache: { x: 10, y: 0, z: 0 },
    });
    const frame = completingFrame();
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);

    expect(frame).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().framedRun).not.toBeNull();
  });

  it('keeps a perimeter no-go finding advisory and still frames', async () => {
    installVectorProject({ minX: 40, minY: 40, maxX: 100, maxY: 100 });
    const bounds = currentMotionBounds();
    setNoGoZone({
      x: (bounds.minX + bounds.maxX) / 2 - 1,
      y: bounds.minY - 1,
      width: 2,
      height: 2,
    });
    const frame = completingFrame();
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);

    expect(frame).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expect(JSON.stringify(reviewHarness.runJobReviewGate.mock.calls[0])).toContain('Clamp');
  });

  it('keeps an interior no-go finding advisory and lets the completed Frame authorize', async () => {
    installVectorProject({ minX: 40, minY: 40, maxX: 100, maxY: 100 });
    const bounds = currentMotionBounds();
    setNoGoZone({
      x: (bounds.minX + bounds.maxX) / 2 - 1,
      y: (bounds.minY + bounds.maxY) / 2 - 1,
      width: 2,
      height: 2,
    });
    const frame = completingFrame();
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);

    expect(frame).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    expect(JSON.stringify(reviewHarness.runJobReviewGate.mock.calls[0])).toContain('Clamp');
  });
});
