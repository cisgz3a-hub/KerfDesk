import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from './laser-mode-start-acknowledgement';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 9;
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
  id: 'recovery-line',
  source: 'recovery-line.svg',
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

describe('exact laser recovery activation', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({
      project: {
        ...createProject(DEFAULT_DEVICE_PROFILE),
        scene: {
          ...EMPTY_SCENE,
          objects: [lineObject],
          layers: [createLayer({ id: 'red', color: '#ff0000' })],
        },
      },
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
    });
    useLaserStore.setState({
      ...initialLaserState(),
      connection: { kind: 'connected' },
      controllerSessionEpoch: CONTROLLER_EPOCH,
      controllerQualification: {
        kind: 'qualified',
        epoch: CONTROLLER_EPOCH,
        settings: 'verified',
      },
      statusReport: idleStatus,
      controllerSettings: {
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
        laserModeEnabled: true,
      },
      controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareAlert).mockClear();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
    vi.restoreAllMocks();
  });

  it('passes a live unknown-$32 acknowledgement into the claimed recovery Start', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    const recoveryStart = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob: recoveryStart });
    makeLaserModeUnknown();
    vi.mocked(jobAwareConfirm).mockClear();

    const started = await runLaserRecoveryCapsuleFlow(capsule, repository);

    expect(started).toBe(true);
    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(recoveryStart).toHaveBeenCalledWith(
      expect.stringContaining('resume preamble'),
      expect.objectContaining({
        runId: expect.stringMatching(/^run-/),
        laserModeStartEvidence: expect.objectContaining({
          laserModeEnabled: undefined,
          unverifiedAcknowledged: true,
          controllerSessionEpoch: CONTROLLER_EPOCH,
        }),
      }),
    );
    expect(repository.getSnapshot().activeRun?.runId).not.toBe(capsule.runId);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('declines unknown $32 before claiming and leaves the capsule retryable', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    const recoveryStart = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob: recoveryStart });
    makeLaserModeUnknown();
    vi.mocked(jobAwareConfirm).mockImplementation(
      (message) => message !== LASER_MODE_UNVERIFIED_START_PROMPT,
    );

    const started = await runLaserRecoveryCapsuleFlow(capsule, repository);

    expect(started).toBe(false);
    expect(recoveryStart).not.toHaveBeenCalled();
    const retained = repository.getSnapshot().recoveryCapsule;
    expect(retained).toMatchObject({
      runId: capsule.runId,
      revision: capsule.revision,
    });
    expect(retained).not.toHaveProperty('claim');
  });

  it('recovers a recovery attempt again after that exact resume run is interrupted', async () => {
    const repository = recoveryHarness();
    const originalCapsule = await interruptedCapsule(repository);
    const recoveryStart = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob: recoveryStart });

    expect(await runLaserRecoveryCapsuleFlow(originalCapsule, repository)).toBe(true);
    const firstRecovery = repository.getSnapshot().activeRun;
    if (firstRecovery === null) throw new Error('Expected the first recovery run.');
    expect(firstRecovery.artifact.laserResumeChain).toHaveLength(1);
    await repository.interruptRun(firstRecovery.runId, 0, {
      kind: 'disconnect',
      message: 'Recovery connection lost.',
    });
    const recoveredAgain = repository.getSnapshot().recoveryCapsule;
    if (recoveredAgain === null) throw new Error('Expected the interrupted recovery capsule.');

    expect(await runLaserRecoveryCapsuleFlow(recoveredAgain, repository)).toBe(true);

    expect(recoveryStart).toHaveBeenCalledTimes(2);
    expect(repository.getSnapshot().activeRun?.artifact.laserResumeChain).toHaveLength(2);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('retries claim release before cleanup and remains retryable when staged discard fails', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    useLaserStore.setState({ startJob: vi.fn(async () => Promise.reject(new Error('refused'))) });
    const releaseClaim = repository.releaseRecoveryClaim.bind(repository);
    let releaseCalls = 0;
    const release = vi
      .spyOn(repository, 'releaseRecoveryClaim')
      .mockImplementation(async (...args) => {
        releaseCalls += 1;
        return releaseCalls === 1
          ? { ok: false, error: 'storage-unavailable' }
          : releaseClaim(...args);
      });
    vi.spyOn(repository, 'discardStagedRun').mockResolvedValue({
      ok: false,
      error: 'storage-unavailable',
    });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(false);

    expect(release).toHaveBeenCalledTimes(2);
    expect(repository.getSnapshot().recoveryCapsule).toMatchObject({ runId: capsule.runId });
    expect(repository.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
  });

  it('treats an unexpected successful staging value as a pre-acceptance failure', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    const recoveryStart = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob: recoveryStart });
    vi.spyOn(repository, 'stageArtifact').mockResolvedValue({ ok: true, value: false as never });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(false);

    expect(recoveryStart).not.toHaveBeenCalled();
    expect(repository.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
  });
});

function recoveryHarness(): RecoveryRepository {
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => null,
    clear: () => undefined,
  };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
  });
}

async function interruptedCapsule(repository: RecoveryRepository): Promise<RecoveryCapsule> {
  await runStartJobFlow(repository);
  const active = repository.getSnapshot().activeRun;
  if (active === null) throw new Error('Expected an active exact run.');
  await repository.interruptRun(active.runId, 0, {
    kind: 'disconnect',
    message: 'Test interruption',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected an exact recovery capsule.');
  return capsule;
}

function makeLaserModeUnknown(): void {
  useLaserStore.setState((state) => ({
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
    },
    controllerSettingsObservation: {
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: 2,
    },
    capabilities: { ...state.capabilities, settings: 'readonly-dump' },
  }));
}
