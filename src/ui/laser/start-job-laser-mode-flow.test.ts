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
import { readJobCheckpoint } from '../state/job-checkpoint-storage';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from './laser-mode-start-acknowledgement';
import { runCheckpointResumeFlow, runStartFromLineFlow, runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;

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
      statusReport: idleStatus,
      controllerSettings: {
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
        laserModeEnabled: true,
      },
      controllerSettingsObservation: { sessionEpoch: 0, observedAt: 1 },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareAlert).mockClear();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
    useToastStore.setState({ toasts: [] });
  });

  it('passes verified evidence and active profile streaming settings into Start', async () => {
    await runStartJobFlow();

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
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
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

    await runStartJobFlow();

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

    await runStartJobFlow();

    expect(jobAwareConfirm).toHaveBeenCalledWith(LASER_MODE_UNVERIFIED_START_PROMPT);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(readJobCheckpoint()).toBeNull();
  });

  it('acknowledges unknown $32 before checkpoint recovery confirmation and streaming', async () => {
    await runStartJobFlow();
    const checkpoint = readJobCheckpoint();
    if (checkpoint === null) throw new Error('Expected checkpoint');
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
    expect(readJobCheckpoint()?.resumeInFlight).toBe(true);
  });

  it('cancels checkpoint recovery before resume confirmation when $32 is declined', async () => {
    await runStartJobFlow();
    const checkpoint = readJobCheckpoint();
    if (checkpoint === null) throw new Error('Expected checkpoint');
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
