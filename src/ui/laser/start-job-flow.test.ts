import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { fingerprintGcode } from '../../core/recovery';
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
import { createExecutionArtifact, RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { useStartBlockerStore } from './start-blocker-store';
import { runCompletedJobAgainFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 7;
// ADR-224: the review dialog gates every shared-flow Start; these tests
// auto-confirm it through the seam.
let uninstallAutoReview: () => void = () => undefined;

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

function runnableProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
}

type RepositoryHarness = {
  readonly repository: RecoveryRepository;
  readonly backend: MemoryRecoveryStorageBackend;
};

function recoveryHarness(): RepositoryHarness {
  const backend = new MemoryRecoveryStorageBackend();
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => null,
    clear: () => undefined,
  };
  return {
    backend,
    repository: new RecoveryRepository({
      backend,
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage,
      nowIso: () => '2026-07-15T12:00:00.000Z',
    }),
  };
}

function startSpy() {
  return vi.mocked(useLaserStore.getState().startJob);
}

async function makeInterruptedRun(repository: RecoveryRepository) {
  await runStartJobFlow(repository);
  const active = repository.getSnapshot().activeRun;
  if (active === null) throw new Error('Expected an active tracked run.');
  await repository.updateProgress(active.runId, Math.min(2, active.sendableLines));
  await repository.interruptRun(active.runId, Math.min(2, active.sendableLines), {
    kind: 'disconnect',
    message: 'Cable removed.',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected an interrupted recovery capsule.');
  return capsule;
}

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  const project = runnableProject();
  useStore.setState({
    project,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
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
    startJob: vi.fn(async () => undefined),
  });
  // The fresh flow consumes the exact completion-issued artifact, not the
  // transitional bounds-only FrameVerification fixture.
  await installFramedRunPermitForCurrentState();
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useStartBlockerStore.getState().clear();
  useToastStore.setState({ toasts: [] });
  useJobReviewStore.getState().close();
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  localStorage.clear();
  useLaserStore.setState({
    ...initialLaserState(),
    startJob: originalStartJob,
  });
  vi.restoreAllMocks();
});

describe('runStartJobFlow', () => {
  it('passes a new run identity and active-profile streaming settings to the streamer', async () => {
    const { repository } = recoveryHarness();
    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        runId: expect.stringMatching(/^run-/),
        streamingMode: 'ping-pong',
        rxBufferBytes: 96,
        machineKind: 'laser',
        laserModeStartEvidence: expect.objectContaining({
          controllerSessionEpoch: CONTROLLER_EPOCH,
          laserModeEnabled: true,
          unverifiedAcknowledged: false,
        }),
        canvasPlan: expect.objectContaining({ capability: 'realtime' }),
      }),
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('allows a no-homing User Origin laser Start after a settings-read failure', async () => {
    const { repository } = recoveryHarness();
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
    useLaserStore.setState({
      controllerQualification: {
        kind: 'failed',
        epoch: CONTROLLER_EPOCH,
        message: 'The controller settings response was empty.',
      },
      controllerSettings: null,
      controllerSettingsObservation: null,
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 0, y: 0, z: 0 },
    });
    await installFramedRunPermitForCurrentState();

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        machineKind: 'laser',
        laserModeStartEvidence: expect.objectContaining({
          laserModeEnabled: undefined,
          unverifiedAcknowledged: true,
        }),
      }),
    );
    expect(useStartBlockerStore.getState().messages).toEqual([]);
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });

  // CNC attestation display/binding and review-cancel behavior live in
  // src/ui/laser/job-review/job-review-gate.test.ts beside the gate.

  it('forces ping-pong for a legacy Marlin profile with char-counted streaming', async () => {
    const { repository } = recoveryHarness();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          controllerKind: 'marlin',
          streamingMode: 'char-counted',
        },
      },
    }));
    useLaserStore.setState({ activeControllerKind: 'marlin', detectedControllerKind: 'marlin' });
    await installFramedRunPermitForCurrentState();

    await runStartJobFlow(repository);

    expect(startSpy().mock.calls[0]?.[1]).toMatchObject({
      streamingMode: 'ping-pong',
      rxBufferBytes: 96,
      machineKind: 'laser',
    });
  });
});

describe('isolated execution recovery ownership', () => {
  it('stores exact streamed G-code as a line-zero active run only after Start is accepted', async () => {
    const { repository } = recoveryHarness();

    await runStartJobFlow(repository);

    const active = repository.getSnapshot().activeRun;
    expect(active).not.toBeNull();
    expect(active?.ackedLines).toBe(0);
    expect(active?.artifact.gcode).toBe(startSpy().mock.calls[0]?.[0]);
    expect(active?.artifact.fingerprint).toEqual(
      fingerprintGcode(startSpy().mock.calls[0]?.[0] ?? ''),
    );
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('does not let a 2516 / 118035 interrupted capsule block a different normal job', async () => {
    const { repository } = recoveryHarness();
    await runStartJobFlow(repository);
    const template = repository.getSnapshot().activeRun?.artifact;
    if (template === undefined) throw new Error('Expected a template artifact.');
    const interruptedGcode = 'G1 X1\n'.repeat(118_035);
    const archived = createExecutionArtifact({
      runId: 'run-118035-lines',
      gcode: interruptedGcode,
      prepared: template.prepared,
      outputScope: template.outputScope,
      canvasPlan: template.canvasPlan,
      controllerSettings: template.archivedControllerObservation.settings,
      createdAtIso: '2026-07-15T11:00:00.000Z',
    });
    await repository.stageArtifact(archived);
    await repository.activateFreshRun(archived.runId);
    await repository.updateProgress(archived.runId, 2_516);
    await repository.interruptRun(archived.runId, 2_516, {
      kind: 'disconnect',
      message: 'Router disconnected.',
    });
    startSpy().mockClear();

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledTimes(1);
    expect(repository.getSnapshot().activeRun?.runId).not.toBe(archived.runId);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    expect(jobAwareAlert).not.toHaveBeenCalledWith(expect.stringContaining('2516'));
  });

  it('preserves the older capsule when a new ordinary Start is refused before acceptance', async () => {
    const { repository } = recoveryHarness();
    const capsule = await makeInterruptedRun(repository);
    useLaserStore.setState({ startJob: vi.fn(async () => Promise.reject(new Error('refused'))) });

    await runStartJobFlow(repository);

    expect(repository.getSnapshot().recoveryCapsule).toEqual(capsule);
    expect(repository.getSnapshot().activeRun).toBeNull();
  });

  it('waits for rejected-run cleanup before the Start flow settles', async () => {
    const { repository } = recoveryHarness();
    const cleanupControl: { finish?: () => void } = {};
    const discard = vi.spyOn(repository, 'discardStagedRun').mockImplementation(
      () =>
        new Promise((resolve) => {
          cleanupControl.finish = () => resolve({ ok: true, value: true });
        }),
    );
    useLaserStore.setState({ startJob: vi.fn(async () => Promise.reject(new Error('refused'))) });
    let settled = false;

    const start = runStartJobFlow(repository).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(discard).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    const finishCleanup = cleanupControl.finish;
    if (finishCleanup === undefined) throw new Error('Expected pending staged-run cleanup.');
    finishCleanup();
    await start;

    expect(settled).toBe(true);
  });

  it('replaces the older capsule only after a new ordinary Start is accepted', async () => {
    const { repository } = recoveryHarness();
    const capsule = await makeInterruptedRun(repository);
    startSpy().mockClear();

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledTimes(1);
    expect(repository.getSnapshot().activeRun?.runId).not.toBe(capsule.runId);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
  });

  it('continues the job with a warning when artifact persistence is unavailable', async () => {
    const { repository, backend } = recoveryHarness();
    backend.failNext('put-artifact');

    await runStartJobFlow(repository);

    expect(startSpy()).toHaveBeenCalledTimes(1);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: expect.stringContaining('recovery is unavailable'),
    });
  });
});

describe('completed-job replay', () => {
  it('runs the exact completed job from line one with a new run identity and no recovery', async () => {
    const { repository } = recoveryHarness();
    await runStartJobFlow(repository);
    const first = repository.getSnapshot().activeRun;
    if (first === null) throw new Error('Expected the first active run.');
    await repository.completeRun(first.runId);
    const receipt = repository.getSnapshot().lastCompletedReceipt;
    if (receipt === null) throw new Error('Expected a completed receipt.');
    startSpy().mockClear();

    await runCompletedJobAgainFlow(receipt, repository);

    const replay = repository.getSnapshot().activeRun;
    expect(startSpy()).toHaveBeenCalledTimes(1);
    expect(replay?.runId).not.toBe(first.runId);
    expect(replay?.ackedLines).toBe(0);
    expect(replay?.artifact.gcode).toBe(first.artifact.gcode);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  });

  it('invalidates replay when the current canvas changes during async compilation', async () => {
    const { repository } = recoveryHarness();
    await runStartJobFlow(repository);
    const first = repository.getSnapshot().activeRun;
    if (first === null) throw new Error('Expected the first active run.');
    await repository.completeRun(first.runId);
    const receipt = repository.getSnapshot().lastCompletedReceipt;
    if (receipt === null) throw new Error('Expected a completed receipt.');
    startSpy().mockClear();

    const replay = runCompletedJobAgainFlow(receipt, repository);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === lineObject.id
              ? { ...object, transform: { ...object.transform, x: object.transform.x + 5 } }
              : object,
          ),
        },
      },
    }));
    await replay;

    expect(startSpy()).not.toHaveBeenCalled();
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  });
});
