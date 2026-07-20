import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useCameraStore } from '../state/camera-store';
import {
  cncControllerEpochOf,
  cncSetupAttestationMatches,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { runCncSupervisedRecoveryFlow } from './cnc-supervised-recovery-flow';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareCurrentStartJob } from './start-job-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const NOW = '2026-07-15T10:00:00.000Z';
const LATER = '2026-07-15T10:01:00.000Z';
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
  bounds: { minX: 10, minY: 10, maxX: 70, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 50, y: 10 },
            { x: 70, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};
const completeRecoveryReview = {
  uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
  qualificationId: 'air-cut-2026-07-15',
  cutterClear: true,
  spindleStopped: true,
  positionRequalified: true,
  toolInspected: true,
  workholdingConfirmed: true,
  priorWorkConfirmed: true,
  clearedPathConfirmed: true,
} as const;

function recoveryProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
}

function repository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

function configureReadyCncRecovery(): void {
  const project = recoveryProject();
  useStore.setState({
    project,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSettings: { maxPowerS: 12_000, minPowerS: 0, laserModeEnabled: false },
    controllerQualification: { kind: 'qualified', epoch: 0, settings: 'verified' },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workZReferenceEpoch: 7,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: 7,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
    },
    // Frame-first (ADR-228): a completed Frame for this exact job is the one
    // Start policy gate; both the seeding Start and the recovery re-prepare
    // check it against the live store (null WCO, work origin inactive here).
    frameVerification: frameVerificationForProject(project),
    startJob: vi.fn(async () => undefined),
  });
}

async function saveInterruptedRun(repo: RecoveryRepository): Promise<RecoveryCapsule> {
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    laser,
    useCameraStore.getState(),
  );
  if (!prepared.ok) {
    throw new Error(`Expected ready CNC job: ${prepared.messages.join('; ')}`);
  }
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'run-archived-cnc',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
    canvasPlan: prepared.canvasPlan,
    ...(prepared.cncToolPlan === undefined ? {} : { cncToolPlan: prepared.cncToolPlan }),
    controllerSettings: laser.controllerSettings,
    controllerObservation: {
      statusReport: laser.statusReport,
      overrides: laser.ovCache,
      accessories: laser.accessoryCache ?? null,
      workZZeroEvidence: laser.workZZeroEvidence,
      activeControllerKind: laser.activeControllerKind,
      controllerSessionEpoch: laser.controllerSessionEpoch,
    },
    createdAtIso: NOW,
  });
  expect((await repo.initialize()).ok).toBe(true);
  expect((await repo.stageArtifact(artifact)).ok).toBe(true);
  expect((await repo.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
  expect(
    (
      await repo.interruptRun(
        artifact.runId,
        Math.min(3, artifact.sendableLines),
        { kind: 'disconnect', message: 'USB connection was lost.' },
        LATER,
      )
    ).ok,
  ).toBe(true);
  const capsule = repo.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected interrupted CNC recovery capsule.');
  return capsule;
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  configureReadyCncRecovery();
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('runCncSupervisedRecoveryFlow', () => {
  it('streams a sealed exact artifact without reading or mutating the open project', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const originalGcode = capsule.artifact.kind === 'exact-execution' ? capsule.artifact.gcode : '';
    const unrelatedOpenProject = createProject();
    useStore.setState({ project: unrelatedOpenProject });
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const started = await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo);

    expect(started).toBe(true);
    expect(useStore.getState().project).toBe(unrelatedOpenProject);
    expect(startJob).toHaveBeenCalledTimes(1);
    const recoveryGcode = startJob.mock.calls[0]?.[0] ?? '';
    expect(recoveryGcode).not.toBe(originalGcode);
    expect(recoveryGcode).toContain('G0 Z3.810');
    expect(recoveryGcode).toContain('M3 S12000');
    expect(recoveryGcode).toContain('G0 X25.000 Y390.000');
    expect(recoveryGcode).toContain('G1 X50.000 Y390.000');
    expect(recoveryGcode).toMatchSnapshot();
    expect(repo.getSnapshot().recoveryCapsule).toBeNull();
    expect(repo.getSnapshot().activeRun?.runId).not.toBe(capsule.runId);
    const options = startJob.mock.calls[0]?.[1] as
      | {
          readonly cncSetupAttestation?: CncSetupAttestation;
          readonly machineKind?: string;
          readonly runId?: string;
        }
      | undefined;
    expect(options?.machineKind).toBe('cnc');
    expect(options?.runId).toBe(repo.getSnapshot().activeRun?.runId);
    expect(repo.getSnapshot().activeRun?.artifact.provenance).toMatchObject({
      schemaVersion: 2,
      workflow: {
        kind: 'cnc-supervised-recovery',
        sourceRunId: capsule.runId,
        uncertaintyEventId: completeRecoveryReview.uncertaintyEventId,
        qualificationId: completeRecoveryReview.qualificationId,
        reviewId: expect.any(String),
        clearedPathProofId: expect.any(String),
        completedPrefixProofId: expect.any(String),
      },
      review: {
        acknowledgement: {
          kind: 'cnc-supervised-recovery',
          review: completeRecoveryReview,
          recoveryPackageConfirmed: true,
          cncSetupConfirmed: true,
        },
      },
    });
    expect(
      cncSetupAttestationMatches(
        options?.cncSetupAttestation,
        recoveryGcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    ).toBe(true);
  });

  it('archives the operator qualification attestation into the recovery artifact (A1)', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    useLaserStore.setState({
      startJob: vi.fn<(gcode: string, options?: object) => Promise<void>>(async () => undefined),
    });
    const stageArtifact = vi.spyOn(repo, 'stageArtifact');

    const started = await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo);

    expect(started).toBe(true);
    const staged = stageArtifact.mock.calls[0]?.[0];
    expect(staged?.recoveryQualification).toBe('air-cut-2026-07-15');
  });

  it('refuses recovery when physical cutter-clear review is incomplete', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncSupervisedRecoveryFlow(
      capsule,
      { ...completeRecoveryReview, cutterClear: false },
      repo,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(repo.getSnapshot().recoveryCapsule?.runId).toBe(capsule.runId);
    expect(repo.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('physically clear'));
  });

  it('releases a pre-acceptance failure and leaves the capsule retryable', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi
      .fn<(gcode: string, options?: object) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Controller settings are not confirmed yet.'))
      .mockResolvedValueOnce(undefined);
    useLaserStore.setState({ startJob });

    const firstStarted = await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo);

    expect(firstStarted).toBe(false);
    const retryable = repo.getSnapshot().recoveryCapsule;
    expect(retryable?.runId).toBe(capsule.runId);
    expect(retryable?.claim).toBeUndefined();
    if (retryable === null) throw new Error('Expected retryable recovery capsule.');

    const secondStarted = await runCncSupervisedRecoveryFlow(
      retryable,
      completeRecoveryReview,
      repo,
    );

    expect(secondStarted).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(2);
    expect(repo.getSnapshot().recoveryCapsule).toBeNull();
    expect(repo.getSnapshot().activeRun?.runId).not.toBe(capsule.runId);
  });

  it('refuses controller-settings drift at the final wire boundary before recovery streaming', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async (_gcode: string, options?: StartJobOptions) => {
      useLaserStore.setState((state) => ({
        controllerSettings: { ...state.controllerSettings, maxPowerS: 1_000 },
      }));
      options?.assertFinalStartAuthorized?.();
    });
    useLaserStore.setState({ startJob });

    expect(await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo)).toBe(false);

    expect(repo.getSnapshot().activeRun).toBeNull();
    expect(repo.getSnapshot().pendingStart).toBeNull();
    expect(repo.getSnapshot().recoveryCapsule).toMatchObject({ runId: capsule.runId });
    expect(repo.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining('No recovery G-code was sent'),
    );
  });

  it('releases the claim even when rejected-attempt artifact cleanup fails', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    useLaserStore.setState({ startJob: vi.fn(async () => Promise.reject(new Error('refused'))) });
    vi.spyOn(repo, 'discardStagedRun').mockResolvedValue({
      ok: false,
      error: 'storage-unavailable',
    });

    const started = await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo);

    expect(started).toBe(false);
    expect(repo.getSnapshot().recoveryCapsule).toMatchObject({ runId: capsule.runId });
    expect(repo.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
  });

  it('treats an unexpected successful staging value as a pre-acceptance failure', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    vi.spyOn(repo, 'stageArtifact').mockResolvedValue({ ok: true, value: false as never });

    const started = await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo);

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(repo.getSnapshot().recoveryCapsule?.claim).toBeUndefined();
  });

  it('refuses a stale capsule after another window has claimed its revision', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    expect(
      (
        await repo.claimRecovery({
          runId: capsule.runId,
          revision: capsule.revision,
          attemptId: 'other-window-attempt',
        })
      ).ok,
    ).toBe(true);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncSupervisedRecoveryFlow(capsule, completeRecoveryReview, repo);

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(repo.getSnapshot().recoveryCapsule?.claim?.attemptId).toBe('other-window-attempt');
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('another window'));
  });
});
