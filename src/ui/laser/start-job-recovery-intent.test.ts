import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { advanceJobCheckpoint, createJobCheckpoint, rawResumeLine } from '../../core/recovery';
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
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { runCheckpointResumeFlow, runStartFromLineFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
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
    nowIso: () => '2026-07-15T12:00:00.000Z',
  });
}

function startSpy() {
  return vi.mocked(useLaserStore.getState().startJob);
}

async function makeInterruptedRun(repository: RecoveryRepository) {
  await runStartJobFlow(repository);
  const active = repository.getSnapshot().activeRun;
  if (active === null) throw new Error('Expected an active tracked run.');
  const acknowledged = Math.min(2, active.sendableLines);
  await repository.updateProgress(active.runId, acknowledged);
  await repository.interruptRun(active.runId, acknowledged, {
    kind: 'disconnect',
    message: 'Cable removed.',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected an interrupted recovery capsule.');
  return capsule;
}

async function compileCurrentLaserJob(): Promise<string> {
  await runStartJobFlow(recoveryHarness());
  const gcode = startSpy().mock.calls[0]?.[0];
  if (typeof gcode !== 'string') throw new Error('Expected Start to compile G-code.');
  return gcode;
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({
    project: {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        streamingMode: 'ping-pong',
        rxBufferBytes: 96,
      }),
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
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('interrupted laser job intent separation', () => {
  it('preserves an older recovery capsule when a new ordinary Start is rejected', async () => {
    const repository = recoveryHarness();
    const interrupted = await makeInterruptedRun(repository);
    const rejectedStart = vi.fn(async () => {
      throw new Error('Controller refused the first write.');
    });
    useLaserStore.setState({ startJob: rejectedStart });

    await runStartJobFlow(repository);

    expect(rejectedStart).toHaveBeenCalledTimes(1);
    expect(repository.getSnapshot().activeRun).toBeNull();
    expect(repository.getSnapshot().recoveryCapsule).toMatchObject({
      runId: interrupted.runId,
      revision: interrupted.revision,
    });
  });

  it('replaces an older recovery capsule only after a new ordinary Start is accepted', async () => {
    const repository = recoveryHarness();
    const interrupted = await makeInterruptedRun(repository);
    const acceptedStart = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob: acceptedStart });

    await runStartJobFlow(repository);

    expect(acceptedStart).toHaveBeenCalledTimes(1);
    expect(repository.getSnapshot().activeRun?.runId).not.toBe(interrupted.runId);
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    expect(jobAwareAlert).not.toHaveBeenCalledWith(expect.stringContaining('Start is blocked'));
  });

  it('refuses a stale legacy checkpoint object after the stored record advances', async () => {
    const gcode = await compileCurrentLaserJob();
    const stale = createJobCheckpoint({
      gcode,
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: '2026-07-07T02:00:00.000Z',
    });
    writeJobCheckpoint(stale);
    writeJobCheckpoint(advanceJobCheckpoint(stale, 2, '2026-07-07T02:01:00.000Z'));
    useLaserStore.setState({ startJob: vi.fn(async () => undefined) });

    await runCheckpointResumeFlow(stale);

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('record changed'));
  });

  it('keeps the explicit legacy fallback on the exact tail of matching G-code', async () => {
    const gcode = await compileCurrentLaserJob();
    const initial = createJobCheckpoint({
      gcode,
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: '2026-07-07T03:00:00.000Z',
    });
    const interrupted = advanceJobCheckpoint(initial, 2, '2026-07-07T03:01:00.000Z');
    writeJobCheckpoint(interrupted);
    const resumedStart = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob: resumedStart });

    await runCheckpointResumeFlow(interrupted);

    const resumeProgram = resumedStart.mock.calls[0]?.[0] ?? '';
    const fromLine = rawResumeLine(gcode, interrupted.ackedLines);
    const exactTail = gcode
      .split('\n')
      .slice(fromLine - 1)
      .join('\n');
    expect(resumeProgram.endsWith(exactTail)).toBe(true);
  });

  it('manual start-from-line invalidates an unrelated legacy recovery record after acceptance', async () => {
    const unrelated = advanceJobCheckpoint(
      createJobCheckpoint({
        gcode: 'G21\nG1 X999 S999\nM5',
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        nowIso: '2026-07-07T05:00:00.000Z',
      }),
      1,
      '2026-07-07T05:01:00.000Z',
    );
    writeJobCheckpoint(unrelated);

    await runStartFromLineFlow(2);

    expect(readJobCheckpoint()).toBeNull();
  });
});
