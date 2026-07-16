import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { JobInterruptionKind } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
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
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  createExecutionArtifact,
  RecoveryRepository,
  type RecoveryCapsule,
} from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import { cncPassRecoveryDefaultPoint } from './cnc-pass-recovery-model';
import type { CncPassRecoveryReview } from './cnc-pass-recovery-review';
import { prepareCurrentStartJob } from './start-job-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const NOW = '2026-07-16T10:00:00.000Z';
const LATER = '2026-07-16T10:01:00.000Z';
const ARCHIVED_WCO = { x: 0, y: 0, z: 0 };
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
const baseReview: CncPassRecoveryReview = {
  cutterClear: true,
  spindleStopped: true,
  workholdingConfirmed: true,
  toolConfirmed: true,
  position: { kind: 're-zeroed' },
  groupIndex: 0,
  passIndex: 0,
};

// Three 1 mm stepdowns so boundary slicing and late-pick have real passes.
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
      layers: [
        {
          ...createLayer({ id: 'red', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 3, depthPerPassMm: 1 },
        },
      ],
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
  useStore.setState({
    project: recoveryProject(),
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
    startJob: vi.fn(async () => undefined),
  });
}

async function saveInterruptedRun(
  repo: RecoveryRepository,
  options?: {
    readonly interruptionKind?: JobInterruptionKind;
    readonly archiveWco?: boolean;
  },
): Promise<RecoveryCapsule> {
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    laser,
    useCameraStore.getState(),
  );
  if (!prepared.ok) {
    throw new Error(`Expected ready CNC job: ${prepared.messages.join('; ')}`);
  }
  const artifact = createExecutionArtifact({
    runId: 'run-archived-cnc',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
    canvasPlan: prepared.canvasPlan,
    ...(prepared.cncToolPlan === undefined ? {} : { cncToolPlan: prepared.cncToolPlan }),
    controllerSettings: laser.controllerSettings,
    controllerObservation: {
      statusReport: laser.statusReport,
      ...(options?.archiveWco === false ? {} : { wco: { ...ARCHIVED_WCO } }),
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
        {
          kind: options?.interruptionKind ?? 'disconnect',
          message: 'USB connection was lost.',
        },
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

describe('cncPassRecoveryDefaultPoint', () => {
  it('defaults to the first pass while acked progress is inside the planner reserve', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    expect(cncPassRecoveryDefaultPoint(capsule)).toMatchObject({
      kind: 'resume-at-pass',
      groupIndex: 0,
      passIndex: 0,
      provenCompletePassCount: 0,
    });
  });
});

describe('runCncPassRecoveryFlow', () => {
  it('streams the sealed job from the default boundary without touching the open project', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const originalGcode = capsule.artifact.kind === 'exact-execution' ? capsule.artifact.gcode : '';
    const unrelatedOpenProject = createProject();
    useStore.setState({ project: unrelatedOpenProject });
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(capsule, baseReview, repo);

    expect(started).toBe(true);
    expect(useStore.getState().project).toBe(unrelatedOpenProject);
    expect(startJob).toHaveBeenCalledTimes(1);
    const recoveryGcode = startJob.mock.calls[0]?.[0] ?? '';
    // A boundary at the very first pass replays the entire sealed program.
    expect(recoveryGcode).toBe(originalGcode);
    expect(repo.getSnapshot().recoveryCapsule).toBeNull();
    const options = startJob.mock.calls[0]?.[1] as
      | {
          readonly cncSetupAttestation?: CncSetupAttestation;
          readonly machineKind?: string;
          readonly runId?: string;
        }
      | undefined;
    expect(options?.machineKind).toBe('cnc');
    expect(options?.runId).toBe(repo.getSnapshot().activeRun?.runId);
    expect(
      cncSetupAttestationMatches(
        options?.cncSetupAttestation,
        recoveryGcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    ).toBe(true);
  });

  it('slices at a later boundary after the explicit late-pick warning', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const originalGcode = capsule.artifact.kind === 'exact-execution' ? capsule.artifact.gcode : '';
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(capsule, { ...baseReview, passIndex: 1 }, repo);

    expect(started).toBe(true);
    const warning = vi.mocked(jobAwareConfirm).mock.calls[0]?.[0] ?? '';
    expect(warning).toContain('START LATER THAN THE COMPUTED SAFE PASS?');
    const recoveryGcode = startJob.mock.calls[0]?.[0] ?? '';
    expect(recoveryGcode).not.toBe(originalGcode);
    expect(recoveryGcode).toContain('passes 2');
    expect(recoveryGcode).toMatchSnapshot();
  });

  it('aborts without controller writes when the late-pick warning is declined', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    vi.mocked(jobAwareConfirm).mockReturnValueOnce(false);

    const started = await runCncPassRecoveryFlow(capsule, { ...baseReview, passIndex: 1 }, repo);

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(repo.getSnapshot().recoveryCapsule).not.toBeNull();
  });

  it('refuses when the physical checklist is incomplete', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, cutterClear: false },
      repo,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('cutter');
  });

  it('accepts retained position when the live work offset matches the archived one', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob, wcoCache: { ...ARCHIVED_WCO } });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it('refuses when the live work offset drifts from the archive during the claim', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    // The real startJob runs this assertion synchronously at the wire
    // boundary, immediately before streamer creation.
    const startJob = vi.fn(
      async (_gcode: string, options?: { assertFinalStartAuthorized?: () => void }) => {
        options?.assertFinalStartAuthorized?.();
      },
    );
    useLaserStore.setState({ startJob, wcoCache: { ...ARCHIVED_WCO } });
    const claim = repo.claimRecovery.bind(repo);
    vi.spyOn(repo, 'claimRecovery').mockImplementation(async (args) => {
      // A status frame lands while the operator reads the confirmation
      // dialogs or while the claim awaits storage: the live WCO no longer
      // matches the archived run, and no epoch records the change.
      useLaserStore.setState({ wcoCache: { x: 0, y: 0.2, z: 0 } });
      return claim(args);
    });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    const alerts = vi.mocked(jobAwareAlert).mock.calls.map(([message]) => String(message));
    expect(alerts.some((message) => message.includes('differs'))).toBe(true);
    expect(repo.getSnapshot().recoveryCapsule).not.toBeNull();
  });

  it('refuses retained position when the live work offset differs', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob, wcoCache: { x: 0, y: 0.2, z: 0 } });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('differs');
  });

  it('refuses retained position without an archived work-offset baseline', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo, { archiveWco: false });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain(
      'no archived work-offset observation',
    );
  });

  it('refuses retained position after a controller reboot interruption', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo, { interruptionKind: 'controller-reboot' });

    const started = await runCncPassRecoveryFlow(
      capsule,
      { ...baseReview, position: { kind: 'retained-confirmed' } },
      repo,
    );

    expect(started).toBe(false);
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('rebooted');
  });

  it('refuses a pass that does not exist in the sealed job', async () => {
    const repo = repository();
    const capsule = await saveInterruptedRun(repo);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncPassRecoveryFlow(capsule, { ...baseReview, passIndex: 99 }, repo);

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(vi.mocked(jobAwareAlert).mock.calls[0]?.[0] ?? '').toContain('does not exist');
  });
});
