import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import type { StatusReport } from '../../core/controllers/grbl';
import { advanceJobCheckpoint, createJobCheckpoint, fingerprintGcode } from '../../core/recovery';
import { useStore } from '../state';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { jobAwareAlert } from '../state/job-aware-dialogs';
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

describe('runStartJobFlow', () => {
  beforeEach(() => {
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
        laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
      },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareAlert).mockClear();
  });

  afterEach(() => {
    useLaserStore.setState({
      ...initialLaserState(),
      startJob: originalStartJob,
    });
    vi.restoreAllMocks();
  });

  it('passes active profile streaming settings into the live job streamer', async () => {
    await runStartJobFlow();

    const startJob = useLaserStore.getState().startJob;
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(startJob).toHaveBeenCalledWith(expect.any(String), {
      streamingMode: 'ping-pong',
      rxBufferBytes: 96,
      machineKind: 'laser',
    });
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });
});

describe('job checkpoint integration (ADR-118)', () => {
  beforeEach(() => {
    localStorage.clear();
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
        laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
      },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareAlert).mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    useLaserStore.setState({
      ...initialLaserState(),
      startJob: originalStartJob,
    });
    vi.restoreAllMocks();
  });

  function streamedGcode(): string {
    const startJob = vi.mocked(useLaserStore.getState().startJob);
    const gcode = startJob.mock.calls[0]?.[0];
    if (typeof gcode !== 'string') throw new Error('startJob was not called with gcode');
    return gcode;
  }

  it('writes a checkpoint fingerprinting the streamed program on start', async () => {
    await runStartJobFlow();

    const checkpoint = readJobCheckpoint();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.fingerprint).toEqual(fingerprintGcode(streamedGcode()));
    expect(checkpoint?.ackedLines).toBe(0);
    expect(checkpoint?.resumeInFlight).toBe(false);
    expect(checkpoint?.machineKind).toBe('laser');
  });

  it('keeps an older checkpoint when the start is refused by startJob', async () => {
    const older = createJobCheckpoint({
      gcode: 'G1 X1 S1\nM5',
      machineKind: 'laser',
      nowIso: '2026-07-07T01:00:00.000Z',
    });
    writeJobCheckpoint(older);
    useLaserStore.setState({
      startJob: vi.fn(async () => {
        throw new Error('refused');
      }),
    });

    await runStartJobFlow();

    expect(readJobCheckpoint()).toEqual(older);
  });

  it('refuses a checkpoint resume when the project no longer matches the fingerprint', async () => {
    const foreign = createJobCheckpoint({
      gcode: 'G1 X999 S999\nM5',
      machineKind: 'laser',
      nowIso: '2026-07-07T01:00:00.000Z',
    });
    writeJobCheckpoint(foreign);

    await runCheckpointResumeFlow(foreign);

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining('no longer produces the same G-code'),
    );
    expect(readJobCheckpoint()).toEqual(foreign);
  });

  it('resumes a matching checkpoint and stamps it resume-in-flight', async () => {
    // First run captures the real compiled program and writes its checkpoint.
    await runStartJobFlow();
    const gcode = streamedGcode();
    const stored = readJobCheckpoint();
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error('unreachable');
    writeJobCheckpoint(advanceJobCheckpoint(stored, 2, '2026-07-07T02:00:00.000Z'));
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const resumed = readJobCheckpoint();
    if (resumed === null) throw new Error('unreachable');
    await runCheckpointResumeFlow(resumed);

    expect(startJob).toHaveBeenCalledTimes(1);
    const resumeProgram = startJob.mock.calls[0]?.[0] ?? '';
    expect(resumeProgram).toContain('resume preamble');
    expect(resumeProgram).not.toBe(gcode);
    expect(readJobCheckpoint()?.resumeInFlight).toBe(true);
  });

  it('manual start-from-line also suspends checkpoint tracking', async () => {
    await runStartJobFlow();
    expect(readJobCheckpoint()?.resumeInFlight).toBe(false);

    await runStartFromLineFlow(2);

    expect(readJobCheckpoint()?.resumeInFlight).toBe(true);
  });
});
