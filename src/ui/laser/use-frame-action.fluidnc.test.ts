import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { findFluidncNonExecutableLines } from '../../core/controllers/fluidnc/fluidnc-line-limit';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { JobBounds } from '../../core/job';
import { createLayer, createProject, EMPTY_SCENE } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore, svgObj } from '../state/test-helpers';
import {
  detectFluidncDivergenceWarnings,
  FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX,
  FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX,
} from './job-review/fluidnc-divergence-warnings';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { captureJobReviewModels } from './job-review/testing';
import { runStartJobFlow } from './start-job-flow';
import { runFrameNow } from './use-frame-action';

const originalFrame = useLaserStore.getState().frame;
const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 7;
let uninstallAutoReview: () => void = () => undefined;

function installFluidncProject(): void {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, controllerKind: 'fluidnc' },
      scene: {
        ...EMPTY_SCENE,
        objects: [svgObj('fluidnc-frame', ['#ff0000'])],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
}

function completeFrame(candidate: FramedRunCandidate): void {
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

function testRepository(): RecoveryRepository {
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => null,
    clear: () => undefined,
  };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
    nowIso: () => '2026-07-29T12:00:00.000Z',
  });
}

beforeEach(() => {
  resetStore();
  installFluidncProject();
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    activeControllerKind: 'fluidnc',
    detectedControllerKind: 'fluidnc',
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: {
      kind: 'qualified',
      epoch: CONTROLLER_EPOCH,
      settings: 'verified',
    },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    activeWcs: 'G54',
    trustedPositionEpoch: 1,
    startJob: vi.fn(async () => undefined),
  });
  useJobReviewStore.getState().close();
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  useStore.getState().newProject();
  useLaserStore.setState({
    ...initialLaserState(),
    frame: originalFrame,
    startJob: originalStartJob,
  });
  vi.restoreAllMocks();
});

describe('runFrameNow FluidNC preparation route', () => {
  it('captures an actual prepared artifact that matches shared-streamer normalization', async () => {
    let capturedCandidate: FramedRunCandidate | undefined;
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        capturedCandidate = candidate;
        completeFrame(candidate);
      },
    );
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);
    if (capturedCandidate === undefined) throw new Error('Frame did not receive a candidate');
    const gcode = capturedCandidate.preparedStart.gcode;
    const normalizedQueuedLines = createStreamer(gcode).queued;

    expect(normalizedQueuedLines.length).toBeGreaterThan(0);
    expect(normalizedQueuedLines.every((line) => line === `${line.trim()}\n`)).toBe(true);
    expect(findFluidncNonExecutableLines(gcode)).toEqual([]);
    expect(
      detectFluidncDivergenceWarnings({
        configured: 'fluidnc',
        active: 'fluidnc',
        detected: 'fluidnc',
        gcode,
      }).some((warning) => warning.startsWith(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX)),
    ).toBe(false);
    expect(frame).toHaveBeenCalledTimes(1);
  });

  it('uses the Frame permit exact artifact in the real second-Start review route', async () => {
    let capturedCandidate: FramedRunCandidate | undefined;
    const frame = vi.fn(
      async (_bounds: JobBounds, _feed: number, candidate?: FramedRunCandidate) => {
        if (candidate === undefined) throw new Error('Frame candidate was not supplied');
        capturedCandidate = candidate;
        completeFrame(candidate);
      },
    );
    const capture = captureJobReviewModels();
    useLaserStore.setState({ frame });

    await expect(runFrameNow()).resolves.toBe(true);
    if (capturedCandidate === undefined) throw new Error('Frame did not receive a candidate');
    await runStartJobFlow(testRepository());

    const reviewWarnings = capture.models[0]?.warnings ?? [];
    expect(reviewWarnings).toContainEqual(
      expect.stringContaining(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX),
    );
    expect(
      reviewWarnings.some((warning) => warning.startsWith(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX)),
    ).toBe(false);
    expect(useLaserStore.getState().startJob).toHaveBeenCalledWith(
      capturedCandidate.preparedStart.gcode,
      expect.objectContaining({ machineKind: 'laser' }),
    );
    capture.stop();
  });
});
