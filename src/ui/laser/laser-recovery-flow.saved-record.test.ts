// Laser recovery acts on the stored record, not on the capsule object it was
// handed: a capsule that a newer write superseded is refused at the claim, and
// a migrated fingerprint-only record resumes only on the exact tail of the
// program the current project reproduces.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  advanceJobCheckpoint,
  createJobCheckpoint,
  rawResumeLine,
  serializeJobCheckpoint,
} from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 9;
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

beforeEach(async () => {
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
    controllerQualification: { kind: 'qualified', epoch: CONTROLLER_EPOCH, settings: 'verified' },
    statusReport: idleStatus,
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  await installFramedRunPermitForCurrentState();
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useJobReviewStore.getState().close();
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('laser recovery against the stored record', () => {
  it('refuses a stale capsule after another window advances the stored record', async () => {
    const repository = recoveryHarness();
    const stale = await interruptedCapsule(repository);
    const otherWindow = await repository.claimRecovery({
      runId: stale.runId,
      revision: stale.revision,
      attemptId: 'other-window',
    });
    expect(otherWindow.ok).toBe(true);
    expect(await repository.releaseRecoveryClaim(stale.runId, 'other-window')).toEqual({
      ok: true,
      value: true,
    });
    const recoveryStart = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob: recoveryStart });

    expect(await runLaserRecoveryCapsuleFlow(stale, repository)).toBe(false);

    expect(recoveryStart).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining('The saved recovery changed or was claimed in another window.'),
    );
    const current = repository.getSnapshot().recoveryCapsule;
    expect(current?.runId).toBe(stale.runId);
    expect(current?.revision).toBeGreaterThan(stale.revision);
    expect(current?.claim).toBeUndefined();
    expect(repository.getSnapshot().activeRun).toBeNull();
  });

  it('resumes a migrated fingerprint-only record on the exact tail of the matching G-code', async () => {
    const gcode = await compileCurrentLaserJob();
    const interrupted = advanceJobCheckpoint(
      createJobCheckpoint({
        gcode,
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        nowIso: '2026-07-07T03:00:00.000Z',
      }),
      2,
      '2026-07-07T03:01:00.000Z',
    );
    const repository = recoveryHarness(serializeJobCheckpoint(interrupted));
    expect((await repository.initialize()).ok).toBe(true);
    const capsule = repository.getSnapshot().recoveryCapsule;
    if (capsule?.artifact.kind !== 'legacy-fingerprint-only') {
      throw new Error('Expected the migrated fingerprint-only record.');
    }
    const resumedStart = vi.fn<(gcode: string, options?: StartJobOptions) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob: resumedStart });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(true);

    const resumeProgram = resumedStart.mock.calls[0]?.[0] ?? '';
    const fromLine = rawResumeLine(gcode, interrupted.ackedLines);
    const exactTail = gcode
      .split('\n')
      .slice(fromLine - 1)
      .join('\n');
    expect(resumeProgram.endsWith(exactTail)).toBe(true);
  });
});

function recoveryHarness(legacyCheckpoint: string | null = null): RecoveryRepository {
  let legacy = legacyCheckpoint;
  const legacyStorage: LegacyCheckpointStorage = {
    read: () => legacy,
    clear: () => {
      legacy = null;
    },
  };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
  });
}

async function compileCurrentLaserJob(): Promise<string> {
  await runStartJobFlow(recoveryHarness());
  const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[0];
  if (typeof gcode !== 'string') throw new Error('Expected Start to compile G-code.');
  return gcode;
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
