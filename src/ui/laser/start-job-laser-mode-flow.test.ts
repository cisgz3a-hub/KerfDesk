import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createJobCheckpoint } from '../../core/recovery';
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
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import type { LegacyCheckpointStorage } from '../state/recovery/legacy-checkpoint-migration';
import { resetStore } from '../state/test-helpers';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from './laser-mode-start-acknowledgement';
import { runCheckpointResumeFlow, runStartFromLineFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 7;

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

describe('laser-mode acknowledgement across Start and recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    useStore.setState({
      project: runnableProject(),
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

  it('passes verified evidence and active profile streaming settings into Start', async () => {
    await runStartJobFlow(recoveryHarness());

    expect(useLaserStore.getState().startJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        streamingMode: 'ping-pong',
        rxBufferBytes: 96,
        machineKind: 'laser',
        laserModeStartEvidence: expect.objectContaining({
          laserModeEnabled: true,
          unverifiedAcknowledged: false,
        }),
        canvasPlan: expect.objectContaining({ capability: 'realtime' }),
      }),
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  afterEach(() => {
    localStorage.clear();
    useLaserStore.setState({
      ...initialLaserState(),
      startJob: originalStartJob,
    });
    vi.restoreAllMocks();
  });

  it('requires informed acknowledgement before an ordinary Start with unknown $32', async () => {
    makeLaserModeUnknown();

    await runStartJobFlow(recoveryHarness());

    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(useLaserStore.getState().startJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        laserModeStartEvidence: expect.objectContaining({
          settingsCapability: 'readonly-dump',
          laserModeEnabled: undefined,
          unverifiedAcknowledged: true,
        }),
      }),
    );
  });

  it('sends no ordinary job when the unknown-$32 acknowledgement is declined', async () => {
    makeLaserModeUnknown();
    vi.mocked(jobAwareConfirm).mockReturnValueOnce(false);

    await runStartJobFlow(recoveryHarness());

    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(readJobCheckpoint()).toBeNull();
  });

  it('acknowledges unknown $32 before checkpoint recovery confirmation and streaming', async () => {
    const checkpoint = await createLegacyCheckpointFromCurrentStart();
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    makeLaserModeUnknown();
    vi.mocked(jobAwareConfirm).mockClear();

    await runCheckpointResumeFlow(checkpoint);

    expect(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0]).toBe(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(vi.mocked(jobAwareConfirm).mock.calls[1]?.[0]).toMatch(/Review resume/i);
    expect(startJob).toHaveBeenCalledWith(
      expect.stringContaining('resume preamble'),
      expect.objectContaining({
        laserModeStartEvidence: expect.objectContaining({
          laserModeEnabled: undefined,
          unverifiedAcknowledged: true,
        }),
      }),
    );
    expect(readJobCheckpoint()).toBeNull();
  });

  it('cancels checkpoint recovery before resume confirmation when $32 is declined', async () => {
    const checkpoint = await createLegacyCheckpointFromCurrentStart();
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    makeLaserModeUnknown();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValueOnce(false);

    await runCheckpointResumeFlow(checkpoint);

    expect(jobAwareConfirm).toHaveBeenCalledTimes(1);
    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(startJob).not.toHaveBeenCalled();
    expect(readJobCheckpoint()?.resumeInFlight).toBe(false);
  });

  it('uses the same $32 acknowledgement before manual recovery confirmation', async () => {
    makeLaserModeUnknown();

    await runStartFromLineFlow(2);

    expect(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0]).toBe(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(vi.mocked(jobAwareConfirm).mock.calls[1]?.[0]).toMatch(/Review resume/i);
    expect(useLaserStore.getState().startJob).toHaveBeenCalledWith(
      expect.stringContaining('resume preamble'),
      expect.objectContaining({
        laserModeStartEvidence: expect.objectContaining({
          laserModeEnabled: undefined,
          unverifiedAcknowledged: true,
        }),
      }),
    );
  });
});

async function createLegacyCheckpointFromCurrentStart() {
  await runStartJobFlow(recoveryHarness());
  const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls.at(-1)?.[0];
  if (typeof gcode !== 'string') throw new Error('Expected compiled laser G-code.');
  const checkpoint = createJobCheckpoint({
    gcode,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: '2026-07-15T12:00:00.000Z',
  });
  writeJobCheckpoint(checkpoint);
  return checkpoint;
}
