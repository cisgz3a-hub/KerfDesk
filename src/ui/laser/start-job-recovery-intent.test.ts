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
import { resetStore } from '../state/test-helpers';
import { runCheckpointResumeFlow, runStartFromLineFlow, runStartJobFlow } from './start-job-flow';
import { runRestartInterruptedJobFlow } from './start-job-restart-flow';

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
    statusReport: idleStatus,
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
    },
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
  it('blocks ordinary Start before any controller write when recovery has progress', async () => {
    const interrupted = advanceJobCheckpoint(
      createJobCheckpoint({
        gcode: 'G21\nG90\nG1 X1 S1\nM5',
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        nowIso: '2026-07-07T01:00:00.000Z',
      }),
      2,
      '2026-07-07T01:01:00.000Z',
    );
    writeJobCheckpoint(interrupted);

    await runStartJobFlow();

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(readJobCheckpoint()).toEqual(interrupted);
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('Start is blocked'));
  });

  it('restarts the matching job from line 1 only through explicit restart', async () => {
    await runStartJobFlow();
    const firstStart = vi.mocked(useLaserStore.getState().startJob);
    const originalGcode = firstStart.mock.calls[0]?.[0];
    const initial = readJobCheckpoint();
    if (initial === null || typeof originalGcode !== 'string') throw new Error('start failed');
    const interrupted = advanceJobCheckpoint(initial, 2, '2026-07-07T02:00:00.000Z');
    writeJobCheckpoint(interrupted);
    const restarted = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob: restarted });

    await runRestartInterruptedJobFlow(interrupted);

    expect(jobAwareConfirm).toHaveBeenCalledWith(expect.stringContaining('This is NOT resume'));
    expect(restarted).toHaveBeenCalledTimes(1);
    expect(restarted.mock.calls[0]?.[0]).toBe(originalGcode);
    expect(readJobCheckpoint()).toMatchObject({ ackedLines: 0, resumeInFlight: false });
  });

  it('refuses a stale checkpoint object after the stored record advances', async () => {
    await runStartJobFlow();
    const stale = readJobCheckpoint();
    if (stale === null) throw new Error('start failed');
    writeJobCheckpoint(advanceJobCheckpoint(stale, 2, '2026-07-07T02:00:00.000Z'));
    useLaserStore.setState({ startJob: vi.fn(async () => undefined) });

    await runCheckpointResumeFlow(stale);

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('record changed'));
  });

  it('replays the exact original tail beginning at the first unconfirmed raw line', async () => {
    await runStartJobFlow();
    const firstStart = vi.mocked(useLaserStore.getState().startJob);
    const gcode = firstStart.mock.calls[0]?.[0];
    const initial = readJobCheckpoint();
    if (initial === null || typeof gcode !== 'string') throw new Error('start failed');
    const interrupted = advanceJobCheckpoint(initial, 2, '2026-07-07T03:00:00.000Z');
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

  it('manual start-from-line never stamps an unrelated checkpoint', async () => {
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

    expect(readJobCheckpoint()).toEqual(unrelated);
    expect(readJobCheckpoint()?.resumeInFlight).toBe(false);
  });
});
