import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import type { StatusReport } from '../../core/controllers/grbl';
import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl/resume-program';
import {
  advanceJobCheckpoint,
  createJobCheckpoint,
  fingerprintGcode,
  fingerprintsEqual,
} from '../../core/recovery';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import {
  CNC_SETUP_ATTESTATION_PROMPT,
  cncControllerEpochOf,
  cncSetupAttestationMatches,
} from '../state/cnc-setup-attestation';
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

function configureReadyCncStart(): void {
  useStore.setState((state) => ({
    project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
  }));
  useLaserStore.setState({
    controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: {
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    },
    workZReferenceEpoch: 7,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: 7,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
    },
  });
}

describe('runStartJobFlow', () => {
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
        laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
      },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareAlert).mockClear();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    localStorage.clear();
    useLaserStore.setState({
      ...initialLaserState(),
      startJob: originalStartJob,
    });
    vi.restoreAllMocks();
  });

  it('passes active profile streaming settings into the live job streamer', async () => {
    await runStartJobFlow();

    const startJob = useLaserStore.getState().startJob;
    expect(startJob).toHaveBeenCalledWith(expect.any(String), {
      streamingMode: 'ping-pong',
      rxBufferBytes: 96,
      machineKind: 'laser',
      canvasPlan: expect.objectContaining({ capability: 'realtime' }),
    });
    expect(jobAwareConfirm).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
  });

  it('requires physical CNC setup confirmation and binds it to the compiled program', async () => {
    configureReadyCncStart();

    await runStartJobFlow();

    expect(jobAwareConfirm).toHaveBeenCalledWith(CNC_SETUP_ATTESTATION_PROMPT);
    const startJob = vi.mocked(useLaserStore.getState().startJob);
    expect(startJob).toHaveBeenCalledTimes(1);
    const gcode = startJob.mock.calls[0]?.[0];
    const options = startJob.mock.calls[0]?.[1];
    if (typeof gcode !== 'string') throw new Error('CNC Start did not compile G-code');
    expect(options?.machineKind).toBe('cnc');
    const epoch = cncControllerEpochOf(useLaserStore.getState());
    expect(cncSetupAttestationMatches(options?.cncSetupAttestation, gcode, epoch)).toBe(true);
  });

  it('does not stream a CNC program when physical setup confirmation is declined', async () => {
    configureReadyCncStart();
    vi.mocked(jobAwareConfirm).mockReturnValueOnce(false);

    await runStartJobFlow();

    expect(jobAwareConfirm).toHaveBeenCalledWith(CNC_SETUP_ATTESTATION_PROMPT);
    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
  });

  it('forces ping-pong when a legacy Marlin profile retained char-counted streaming', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          controllerKind: 'marlin',
          streamingMode: 'char-counted',
        },
      },
    }));
    useLaserStore.setState({
      activeControllerKind: 'marlin',
      detectedControllerKind: 'marlin',
    });

    await runStartJobFlow();

    const options = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[1];
    expect(options).toMatchObject({
      streamingMode: 'ping-pong',
      rxBufferBytes: 96,
      machineKind: 'laser',
    });
  });
});

describe('job checkpoint integration (ADR-118)', () => {
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
        laserModeEnabled: DEFAULT_DEVICE_PROFILE.laserModeEnabled,
      },
      startJob: vi.fn(async () => undefined),
    });
    vi.mocked(jobAwareAlert).mockClear();
    vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
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
      outputScope: DEFAULT_OUTPUT_SCOPE,
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
      outputScope: DEFAULT_OUTPUT_SCOPE,
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

  it('resumes after a crash reset the output scope the run used (PST-02)', async () => {
    const objectB: SceneObject = {
      ...lineObject,
      id: 'line-object-b',
      bounds: { minX: 20, minY: 20, maxX: 30, maxY: 30 },
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              points: [
                { x: 21, y: 21 },
                { x: 29, y: 29 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    useStore.setState({
      project: {
        ...runnableProject(),
        scene: {
          ...EMPTY_SCENE,
          objects: [lineObject, objectB],
          layers: [createLayer({ id: 'red', color: '#ff0000' })],
        },
      },
      selectedObjectId: 'line-object',
      additionalSelectedIds: new Set(),
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
    });

    await runStartJobFlow();
    const selectiveGcode = streamedGcode();
    const stored = readJobCheckpoint();
    if (stored === null) throw new Error('unreachable');
    expect(stored.outputScope.cutSelectedGraphics).toBe(true);
    expect(stored.outputScope.selectedObjectIds).toEqual(['line-object']);
    expect(fingerprintsEqual(fingerprintGcode(selectiveGcode), stored.fingerprint)).toBe(true);

    useStore.setState({
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      outputScopeSettings: { cutSelectedGraphics: false, useSelectionOrigin: false },
    });
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });
    vi.mocked(jobAwareAlert).mockClear();

    await runCheckpointResumeFlow(stored);

    expect(jobAwareAlert).not.toHaveBeenCalledWith(
      expect.stringContaining('no longer produces the same G-code'),
    );
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it('resumes a Current-Position job after the head moved (R1)', async () => {
    const headAt = (x: number, y: number): StatusReport => ({
      ...idleStatus,
      mPos: { x, y, z: 0 },
    });
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    useLaserStore.setState({ statusReport: headAt(10, 10) });

    await runStartJobFlow();
    const started = readJobCheckpoint();
    if (started === null) throw new Error('unreachable');
    expect(started.jobOrigin).toEqual({
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 10, y: 10 },
    });

    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob, statusReport: headAt(60, 60) });
    vi.mocked(jobAwareAlert).mockClear();

    await runCheckpointResumeFlow(started);

    expect(jobAwareAlert).not.toHaveBeenCalledWith(
      expect.stringContaining('no longer produces the same G-code'),
    );
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it('manual start-from-line also suspends checkpoint tracking', async () => {
    await runStartJobFlow();
    expect(readJobCheckpoint()?.resumeInFlight).toBe(false);

    await runStartFromLineFlow(2);

    expect(readJobCheckpoint()?.resumeInFlight).toBe(true);
  });

  it('refuses manual CNC start-from-line before compiling or streaming', async () => {
    useStore.getState().setMachineKind('cnc');

    await runStartFromLineFlow(2);

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining(CNC_AUTOMATIC_RECOVERY_DISABLED_REASON),
    );
  });

  it('keeps a CNC checkpoint as evidence and refuses to execute it', async () => {
    const checkpoint = createJobCheckpoint({
      gcode: 'G21\nG90\nM3 S12000\nG1 X10 F500\nM5',
      machineKind: 'cnc',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: '2026-07-13T01:00:00.000Z',
    });
    writeJobCheckpoint(advanceJobCheckpoint(checkpoint, 2, '2026-07-13T01:01:00.000Z'));

    const stored = readJobCheckpoint();
    if (stored === null) throw new Error('unreachable');
    await runCheckpointResumeFlow(stored);

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining(CNC_AUTOMATIC_RECOVERY_DISABLED_REASON),
    );
    expect(readJobCheckpoint()).toEqual(stored);
  });
});
