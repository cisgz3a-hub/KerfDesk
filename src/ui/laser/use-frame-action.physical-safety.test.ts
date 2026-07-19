import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeJobMotionBounds, machineSpaceJob, type JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
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

describe('Frame physical-safety preflight', () => {
  it.each([
    [{ maxPowerS: 255, laserModeEnabled: true }, '$30'],
    [{ maxPowerS: 1000, laserModeEnabled: false }, '$32=0'],
  ] as const)(
    'sends no Frame motion for a known-wrong live setting %o',
    async (settings, label) => {
      installVectorProject({ minX: 40, minY: 40, maxX: 100, maxY: 100 });
      const frame = vi.fn(async () => undefined);
      useLaserStore.setState({ controllerSettings: settings, frame });

      await expect(runFrameNow()).resolves.toBe(false);

      expect(reviewHarness.runJobReviewGate).not.toHaveBeenCalled();
      expect(frame).not.toHaveBeenCalled();
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useToastStore.getState().toasts.at(-1)?.message).toContain(label);
    },
  );

  it('sends no Frame motion when the reviewed motion envelope is outside the bed', async () => {
    installVectorProject({ minX: 390, minY: 10, maxX: 410, maxY: 20 });
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(frame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/cannot frame.*bed/i);
  });

  it('applies a trusted work offset before checking the physical bed envelope', async () => {
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
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(frame).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/cannot frame.*bed/i);
  });

  it('sends no Frame motion when the perimeter intersects an enabled no-go zone', async () => {
    installVectorProject({ minX: 40, minY: 40, maxX: 100, maxY: 100 });
    const bounds = currentMotionBounds();
    setNoGoZone({
      x: (bounds.minX + bounds.maxX) / 2 - 1,
      y: bounds.minY - 1,
      width: 2,
      height: 2,
    });
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(frame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/perimeter.*Clamp/i);
  });

  it('cannot earn a permit when the job crosses a no-go zone inside a clear perimeter', async () => {
    installVectorProject({ minX: 40, minY: 40, maxX: 100, maxY: 100 });
    const bounds = currentMotionBounds();
    setNoGoZone({
      x: (bounds.minX + bounds.maxX) / 2 - 1,
      y: (bounds.minY + bounds.maxY) / 2 - 1,
      width: 2,
      height: 2,
    });
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(false);

    expect(frame).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/job path.*Clamp/i);
  });
});
