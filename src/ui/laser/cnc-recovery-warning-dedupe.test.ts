import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { PreflightIssue } from '../../core/preflight';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import type * as GcodeModule from '../../io/gcode';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { resetStore } from '../state/test-helpers';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import type { CncPassRecoveryReview } from './cnc-pass-recovery-review';
import { configureReadyCncRecovery, injectPreflightIssues } from './cnc-recovery-flow-testing';
import {
  runCncSupervisedRecoveryFlow,
  type CncSupervisedRecoveryReview,
} from './cnc-supervised-recovery-flow';
import { prepareCurrentStartJob } from './start-job-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

vi.mock('../../io/gcode', async (importOriginal) => {
  const actual = await importOriginal<typeof GcodeModule>();
  return { ...actual, emitPreparedGcode: vi.fn(actual.emitPreparedGcode) };
});

const originalStartJob = useLaserStore.getState().startJob;
const NOW = '2026-07-28T10:00:00.000Z';
const LATER = '2026-07-28T10:01:00.000Z';
const DUPLICATED_WARNING_COUNT = 130;
const INTERRUPTED_ACKNOWLEDGED_LINES = 3;
const LAYER_COLOR = '#ff0000';
const LAYER_ID = 'red';
const LINE_OBJECT_ID = 'warning-dedupe-line';
const LINE_POINT_COUNT = 4;
const LINE_SOURCE = 'warning-dedupe-line.svg';
const LINE_START_X_MM = 10;
const LINE_STEP_MM = 20;
const LINE_Y_MM = 10;
const POLICY_WARNING_CODE: PreflightIssue['code'] = 'out-of-bed';
const RECOVERY_DEPTH_MM = 3;
const RECOVERY_RX_BUFFER_BYTES = 96;
const WARNING_CONFIRMATION_PREFIX = 'Controller warning:';
const WARNING_INDEX_FILL = '0';
const WARNING_INDEX_WIDTH = 3;
const WARNING_MESSAGE_PREFIX = 'Recovery bed warning ';
const WARNING_BULLET = '• ';
const linePoints = Array.from({ length: LINE_POINT_COUNT }, (_, index) => ({
  x: LINE_START_X_MM + index * LINE_STEP_MM,
  y: LINE_Y_MM,
}));
const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: LINE_OBJECT_ID,
  source: LINE_SOURCE,
  bounds: {
    minX: LINE_START_X_MM,
    minY: LINE_Y_MM,
    maxX: LINE_START_X_MM + (LINE_POINT_COUNT - 1) * LINE_STEP_MM,
    maxY: LINE_Y_MM,
  },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: LAYER_COLOR,
      polylines: [
        {
          points: linePoints,
          closed: false,
        },
      ],
    },
  ],
};
const passReview: CncPassRecoveryReview = {
  cutterClear: true,
  spindleStopped: true,
  workholdingConfirmed: true,
  toolConfirmed: true,
  position: { kind: 're-zeroed' },
  groupIndex: 0,
  passIndex: 0,
};
const supervisedReview: CncSupervisedRecoveryReview = {
  uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
  qualificationId: 'warning-dedupe-air-cut',
  cutterClear: true,
  spindleStopped: true,
  positionRequalified: true,
  toolInspected: true,
  workholdingConfirmed: true,
  priorWorkConfirmed: true,
  clearedPathConfirmed: true,
};
const duplicatedWarningIssues: ReadonlyArray<PreflightIssue> = Array.from(
  { length: DUPLICATED_WARNING_COUNT },
  (_, index) => ({
    code: POLICY_WARNING_CODE,
    message: `${WARNING_MESSAGE_PREFIX}${index
      .toString()
      .padStart(WARNING_INDEX_WIDTH, WARNING_INDEX_FILL)}`,
  }),
);

type RecoveryRunner = (
  capsule: RecoveryCapsule,
  repository: RecoveryRepository,
) => Promise<boolean>;

const recoveryCases: ReadonlyArray<{
  readonly name: string;
  readonly run: RecoveryRunner;
}> = [
  {
    name: 'pass recovery',
    run: (capsule, repository) => runCncPassRecoveryFlow(capsule, passReview, repository),
  },
  {
    name: 'supervised recovery',
    run: (capsule, repository) =>
      runCncSupervisedRecoveryFlow(capsule, supervisedReview, repository),
  },
];

function recoveryProject() {
  const deviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    streamingMode: 'ping-pong',
    rxBufferBytes: RECOVERY_RX_BUFFER_BYTES,
  } satisfies DeviceProfile;
  return {
    ...createProject(deviceProfile),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [
        {
          ...createLayer({ id: LAYER_ID, color: LAYER_COLOR }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            depthMm: RECOVERY_DEPTH_MM,
            depthPerPassMm: 1,
          },
        },
      ],
    },
  };
}

function recoveryRepository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

async function saveInterruptedRun(repository: RecoveryRepository): Promise<RecoveryCapsule> {
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
    runId: 'warning-dedupe-run',
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
  expect((await repository.initialize()).ok).toBe(true);
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
  expect(
    (
      await repository.interruptRun(
        artifact.runId,
        Math.min(INTERRUPTED_ACKNOWLEDGED_LINES, artifact.sendableLines),
        { kind: 'disconnect', message: 'USB connection was lost.' },
        LATER,
      )
    ).ok,
  ).toBe(true);
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected interrupted CNC recovery capsule.');
  return capsule;
}

function confirmedWarningMessages(): ReadonlyArray<string> {
  const warningConfirmation = vi
    .mocked(jobAwareConfirm)
    .mock.calls.map(([message]) => String(message))
    .find((message) => message.startsWith(WARNING_CONFIRMATION_PREFIX));
  return (
    warningConfirmation
      ?.split('\n')
      .filter((line) => line.startsWith(WARNING_BULLET))
      .map((line) => line.slice(WARNING_BULLET.length)) ?? []
  );
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  configureReadyCncRecovery(recoveryProject());
  useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe.each(recoveryCases)('$name warning aggregation', ({ run }) => {
  it('starts with one ordered copy of more than 128 duplicated advisories', async () => {
    const repository = recoveryRepository();
    const capsule = await saveInterruptedRun(repository);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    await injectPreflightIssues(duplicatedWarningIssues);

    const started = await run(capsule, repository);

    expect(started).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jobAwareAlert)).not.toHaveBeenCalled();
    const shownWarnings = confirmedWarningMessages();
    expect(shownWarnings.filter((warning) => warning.startsWith(WARNING_MESSAGE_PREFIX))).toEqual(
      duplicatedWarningIssues.map((issue) => issue.message),
    );
    expect(new Set(shownWarnings).size).toBe(shownWarnings.length);
    expect(repository.getSnapshot().activeRun?.artifact.provenance).toMatchObject({
      review: { warningsShown: shownWarnings },
    });
  });
});
