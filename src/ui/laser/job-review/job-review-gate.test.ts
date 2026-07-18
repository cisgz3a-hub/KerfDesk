import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncControllerEpochOf,
  cncSetupAttestationMatches,
} from '../../state/cnc-setup-attestation';
import { jobAwareAlert } from '../../state/job-aware-dialogs';
import type { FramedRunCandidate } from '../../state/framed-run';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { RecoveryRepository } from '../../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../../state/recovery/testing';
import { resetStore } from '../../state/test-helpers';
import { completeFramedRunCandidateForTest } from '../framed-run-testing';
import { captureStartExternalEnvironment } from '../start-job-external-environment';
import { prepareCurrentStartJob } from '../start-job-source';
import { useStartBlockerStore } from '../start-blocker-store';
import { runStartJobFlow } from '../start-job-flow';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';
import { captureJobReviewModels } from './testing';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const originalFrame = useLaserStore.getState().frame;
const CONTROLLER_EPOCH = 7;

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'line-object',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function recoveryHarness(): RecoveryRepository {
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => null,
    clear: () => undefined,
  };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
    nowIso: () => '2026-07-17T12:00:00.000Z',
  });
}

function configureReadyCncStart(): void {
  useStore.setState((state) => ({
    project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
  }));
  useLaserStore.setState({
    controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workZReferenceEpoch: CONTROLLER_EPOCH,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: CONTROLLER_EPOCH,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
    },
  });
}

function startSpy() {
  return vi.mocked(useLaserStore.getState().startJob);
}

function frameSpy() {
  return vi.mocked(useLaserStore.getState().frame);
}

function installCompletingFrame(): void {
  useLaserStore.setState({
    frame: vi.fn(async (_bounds, _feed, candidate?: FramedRunCandidate) => {
      if (candidate === undefined) throw new Error('Frame candidate was not supplied.');
      completeFramedRunCandidateForTest(candidate);
    }),
  });
}

function reviewState() {
  return useJobReviewStore.getState().state;
}

async function unframedReviewBundle() {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const externalEnvironment = captureStartExternalEnvironment(app.project, camera);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    camera,
    externalEnvironment.rotaryRasterAllowed,
    undefined,
    false,
  );
  if (!prepared.ok)
    throw new Error(`Frame review preparation failed: ${prepared.messages.join(' / ')}`);
  return {
    app,
    project: app.project,
    laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    externalEnvironment,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  const project = {
    ...createProject(DEFAULT_DEVICE_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  useStore.setState({
    project,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    activeWcs: 'G54',
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: { kind: 'qualified', epoch: CONTROLLER_EPOCH, settings: 'verified' },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  installCompletingFrame();
  useStartBlockerStore.getState().clear();
  useJobReviewStore.getState().close();
  vi.mocked(jobAwareAlert).mockClear();
});

afterEach(() => {
  useJobReviewStore.getState().close();
  localStorage.clear();
  useLaserStore.setState({
    ...initialLaserState(),
    startJob: originalStartJob,
    frame: originalFrame,
  });
  vi.restoreAllMocks();
});

describe('runJobReviewGate through runStartJobFlow', () => {
  it('preserves frame purpose and rebuilds without requiring an earlier Frame', async () => {
    useLaserStore.setState({ frameVerification: null });
    const initial = await unframedReviewBundle();
    const capture = captureJobReviewModels();

    const review = runJobReviewGate({
      initial,
      checkpointToReplace: null,
      completedReceipt: null,
      purpose: 'frame',
    });
    await vi.waitFor(() => expect(capture.models).toHaveLength(1));
    expect(reviewState()).toMatchObject({ kind: 'open', purpose: 'frame' });

    useJobReviewStore.getState().requestRebuild();
    await vi.waitFor(() => expect(capture.models).toHaveLength(2));
    const rebuilt = reviewState();
    expect(rebuilt.kind === 'open' ? rebuilt.blocker : ['closed']).toBeNull();
    expect(rebuilt.kind === 'open' ? rebuilt.purpose : null).toBe('frame');

    useJobReviewStore.getState().confirm();
    await expect(review).resolves.not.toBeNull();
    capture.stop();
  });

  it('cancel closes the review with zero side effects', async () => {
    const repository = recoveryHarness();

    const flow = runStartJobFlow(repository);
    await vi.waitFor(() => expect(reviewState().kind).toBe('open'));
    useJobReviewStore.getState().cancel();
    await flow;

    expect(startSpy()).not.toHaveBeenCalled();
    expect(reviewState().kind).toBe('idle');
    expect(useStartBlockerStore.getState().messages).toEqual([]);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });

  it('reviews and Frames on the first press, then starts those exact CNC bytes on the second', async () => {
    configureReadyCncStart();
    const repository = recoveryHarness();
    const capture = captureJobReviewModels();

    const flow = runStartJobFlow(repository);
    await vi.waitFor(() => expect(capture.models.length).toBe(1));
    expect(capture.models[0]?.acknowledgement).toEqual({
      kind: 'cnc',
      prompt: CNC_SETUP_ATTESTATION_PROMPT,
    });
    useJobReviewStore.getState().confirm();
    await flow;
    capture.stop();

    expect(frameSpy()).toHaveBeenCalledTimes(1);
    expect(startSpy()).not.toHaveBeenCalled();
    expect(useLaserStore.getState().framedRun).not.toBeNull();

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledTimes(1);
    const gcode = startSpy().mock.calls[0]?.[0];
    const options = startSpy().mock.calls[0]?.[1];
    if (typeof gcode !== 'string') throw new Error('CNC Start did not compile G-code.');
    expect(options?.machineKind).toBe('cnc');
    expect(
      cncSetupAttestationMatches(
        options?.cncSetupAttestation,
        gcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    ).toBe(true);
  });

  it('does not stream a CNC program when the review is cancelled', async () => {
    configureReadyCncStart();
    const repository = recoveryHarness();

    const flow = runStartJobFlow(repository);
    await vi.waitFor(() => expect(reviewState().kind).toBe('open'));
    useJobReviewStore.getState().cancel();
    await flow;

    expect(startSpy()).not.toHaveBeenCalled();
  });

  it('streams the re-prepared program after an in-review edit and attests the exact bytes', async () => {
    configureReadyCncStart();
    const repository = recoveryHarness();
    const capture = captureJobReviewModels();

    const flow = runStartJobFlow(repository);
    await vi.waitFor(() => expect(capture.models.length).toBe(1));
    useStore.getState().setLayerParam('red', {
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 },
    });
    useJobReviewStore.getState().requestRebuild();
    await vi.waitFor(() => expect(capture.models.length).toBe(2));
    useJobReviewStore.getState().confirm();
    await flow;
    capture.stop();

    expect(frameSpy()).toHaveBeenCalledTimes(1);
    expect(startSpy()).not.toHaveBeenCalled();

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledTimes(1);
    const gcode = startSpy().mock.calls[0]?.[0];
    const options = startSpy().mock.calls[0]?.[1];
    if (typeof gcode !== 'string') throw new Error('Expected streamed G-code.');
    expect(gcode).toContain('F777');
    expect(
      cncSetupAttestationMatches(
        options?.cncSetupAttestation,
        gcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    ).toBe(true);
  });

  it('a refused re-prepare blocks Confirm in place until the operator fixes it', async () => {
    const repository = recoveryHarness();

    const flow = runStartJobFlow(repository);
    await vi.waitFor(() => expect(reviewState().kind).toBe('open'));
    useLaserStore.setState({ alarmCode: 2 });
    useJobReviewStore.getState().requestRebuild();
    await vi.waitFor(() => {
      const state = reviewState();
      expect(state.kind === 'open' && state.blocker !== null).toBe(true);
    });
    const blocked = reviewState();
    expect(blocked.kind === 'open' ? blocked.blocker?.join(' ') : '').toMatch(/alarm/i);

    useJobReviewStore.getState().confirm();
    expect(reviewState().kind).toBe('open');
    expect(startSpy()).not.toHaveBeenCalled();

    useLaserStore.setState({ alarmCode: null });
    useJobReviewStore.getState().requestRebuild();
    await vi.waitFor(() => {
      const state = reviewState();
      expect(state.kind === 'open' && state.blocker === null && !state.isPreparing).toBe(true);
    });
    useJobReviewStore.getState().confirm();
    await flow;

    expect(frameSpy()).toHaveBeenCalledTimes(1);
    expect(startSpy()).not.toHaveBeenCalled();

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledTimes(1);
  });
});
