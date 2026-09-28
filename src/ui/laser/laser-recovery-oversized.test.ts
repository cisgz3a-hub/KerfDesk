// A laser job too large for the exact recovery archive (ADR-341 Amendment 8):
// an interruption leaves a fingerprint-only record with the origin at Start,
// the Review continues it without an archive, and a second interruption of
// that recovery leaves a record in the job's own lines.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSendableGcodeLine, type StatusReport } from '../../core/controllers/grbl';
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
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import * as artifactSize from '../state/recovery/execution-artifact-size';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { resumeProgressMap } from './laser-recovery-untracked';
import { buildLaserResumeProgram } from './laser-resume-program';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const CONTROLLER_EPOCH = 9;
const ORIGIN = { x: 50, y: 40, z: 0 };
const originalStartJob = useLaserStore.getState().startJob;
let uninstallAutoReview: () => void = () => undefined;

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 50, y: 40, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const zigzag: SceneObject = {
  kind: 'imported-svg',
  id: 'oversized-zigzag',
  source: 'zigzag.svg',
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: Array.from({ length: 12 }, (_, i) => ({ x: i * 3, y: i % 2 === 0 ? 0 : 10 })),
          closed: false,
        },
      ],
    },
  ],
};

describe('laser job too large for the recovery archive', () => {
  beforeEach(async () => {
    resetStore();
    useStore.setState({
      project: {
        ...createProject(DEFAULT_DEVICE_PROFILE),
        scene: {
          ...EMPTY_SCENE,
          objects: [zigzag],
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
      wcoCache: ORIGIN,
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
    // Every archive, the job's and its recovery's, is over the budget.
    vi.spyOn(artifactSize, 'measureExecutionArtifactBytesWithinBudget').mockImplementation(() => {
      throw new artifactSize.ExecutionArtifactTooLargeError();
    });
  });

  afterEach(() => {
    uninstallAutoReview();
    useJobReviewStore.getState().close();
    useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
    vi.restoreAllMocks();
  });

  it('keeps a record through an interruption and continues it twice from the Review', async () => {
    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
    });
    const starts: Array<{ readonly gcode: string; readonly runId: string }> = [];
    useLaserStore.setState({
      startJob: vi.fn(async (gcode: string, options?: StartJobOptions) => {
        starts.push({ gcode, runId: options?.runId ?? '' });
      }),
    });

    await runStartJobFlow(repository);
    const job = starts[0];
    if (job === undefined) throw new Error('Expected the job to start.');
    expect(repository.getSnapshot().activeRun).toBeNull();
    const jobLines = job.gcode.split('\n').filter(isSendableGcodeLine).length;

    await repository.interruptRun(job.runId, 6, { kind: 'disconnect', message: 'Lost.' });
    const first = repository.getSnapshot().recoveryCapsule;
    if (first === null) throw new Error('Expected a record of the interrupted job.');
    expect(first).toMatchObject({ runId: job.runId, ackedLines: 6, sendableLines: jobLines });
    expect(first.artifact).toMatchObject({
      kind: 'legacy-fingerprint-only',
      startWorkOffsetMm: ORIGIN,
    });

    expect(await runLaserRecoveryCapsuleFlow(first, repository)).toBe(true);
    const recovery = starts[1];
    if (recovery === undefined) throw new Error('Expected the recovery to start.');
    expect(recovery.gcode).toContain('resume preamble');
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    expect(repository.getSnapshot().activeRun).toBeNull();

    const fromLine = restartLine(job.gcode, 6);
    const resume = buildLaserResumeProgram(job.gcode, fromLine, DEFAULT_DEVICE_PROFILE);
    if (resume.kind !== 'ok') throw new Error(resume.reason);
    expect(recovery.gcode).toBe(resume.lines.join('\n'));
    const map = resumeProgressMap(job.gcode, recovery.gcode, fromLine, resume.preambleCount);
    if (map === null) throw new Error('Expected the resume to line up with the job.');
    await repository.interruptRun(recovery.runId, map.preambleLines + 3, {
      kind: 'disconnect',
      message: 'Lost again.',
    });
    const second = repository.getSnapshot().recoveryCapsule;
    expect(second).toMatchObject({ runId: recovery.runId, ackedLines: map.jobLinesBefore + 3 });
    expect(second?.artifact.fingerprint).toEqual(first.artifact.fingerprint);

    if (second === null) throw new Error('Expected a record of the interrupted recovery.');
    expect(await runLaserRecoveryCapsuleFlow(second, repository)).toBe(true);
    expect(starts).toHaveLength(3);
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });
});

/** The file line after `acked` sendable lines, as the automatic restart picks it. */
function restartLine(gcode: string, acked: number): number {
  let sendable = 0;
  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (sendable === acked && isSendableGcodeLine(lines[i] ?? '')) return i + 1;
    if (isSendableGcodeLine(lines[i] ?? '')) sendable += 1;
  }
  return lines.length;
}
