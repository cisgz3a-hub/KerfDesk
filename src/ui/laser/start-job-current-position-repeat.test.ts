import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { createFramedRunPermit } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { RecoveryRepository } from '../state/recovery';
import { resetStore } from '../state/test-helpers';
import {
  framedRunPermitForCurrentState,
  installFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runCompletedJobAgainFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const CONTROLLER_EPOCH = 7;
const originalStartJob = useLaserStore.getState().startJob;
let uninstallAutoReview: () => void = () => undefined;
const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

function runnableProject() {
  return {
    ...createProject(DEFAULT_DEVICE_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [{ ...createLayer({ id: 'red', color: '#ff0000' }), power: 10 }],
    },
  };
}

function recoveryRepository(): RecoveryRepository {
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => null,
    clear: () => undefined,
  };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
    nowIso: () => '2026-07-16T12:00:00.000Z',
  });
}

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  const project = runnableProject();
  useStore.setState({
    project,
    jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: { ...idleStatus, mPos: { x: 120, y: 80, z: 0 } },
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
  await installFramedRunPermitForCurrentState();
  useJobReviewStore.getState().close();
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('completed Current Position replay', () => {
  it('streams the exact framed bytes after Frame motion changes the live head position', async () => {
    const repository = recoveryRepository();
    const preparedAtOriginalHead = await framedRunPermitForCurrentState();
    const exactGcode = preparedAtOriginalHead.candidate.preparedStart.gcode;

    // A real Frame ends with a final controller snapshot. Model a different
    // final point and issue the permit from that state; Start must consume the
    // cached candidate, not re-resolve Current Position from this new report.
    useLaserStore.setState({
      statusReport: { ...idleStatus, mPos: { x: 5, y: 6, z: 0 } },
    });
    const permit = createFramedRunPermit(
      preparedAtOriginalHead.candidate,
      useLaserStore.getState(),
    );
    useLaserStore.setState({
      framedRun: permit,
      frameVerification: permit.candidate.frameVerification,
    });

    await runStartJobFlow(repository);

    expect(useLaserStore.getState().startJob).toHaveBeenCalledWith(exactGcode, expect.any(Object));
    expect(repository.getSnapshot().activeRun?.artifact.jobOrigin).toEqual({
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 120, y: 80 },
    });
  });

  it('reuses the frozen origin after the live head moves', async () => {
    const repository = recoveryRepository();
    await runStartJobFlow(repository);
    const first = repository.getSnapshot().activeRun;
    if (first === null) throw new Error('Expected the first active run.');
    expect(first.artifact.jobOrigin).toEqual({
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 120, y: 80 },
    });
    expect(first.artifact.gcode.trimEnd()).toMatch(/G0 X120\.000 Y80\.000 S0$/);

    await repository.completeRun(first.runId);
    const receipt = repository.getSnapshot().lastCompletedReceipt;
    if (receipt === null) throw new Error('Expected a completed receipt.');
    vi.mocked(useLaserStore.getState().startJob).mockClear();
    useLaserStore.setState({
      statusReport: { ...idleStatus, mPos: { x: 0, y: 0, z: 0 } },
    });

    await runCompletedJobAgainFlow(receipt, repository);

    const replay = repository.getSnapshot().activeRun;
    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
    expect(replay?.artifact.jobOrigin).toEqual(first.artifact.jobOrigin);
    expect(replay?.artifact.gcode).toBe(first.artifact.gcode);
  });
});
