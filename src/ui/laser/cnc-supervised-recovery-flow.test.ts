import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { markResumeInFlight } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import {
  cncControllerEpochOf,
  cncSetupAttestationMatches,
  type CncSetupAttestation,
} from '../state/cnc-setup-attestation';
import { runCncSupervisedRecoveryFlow } from './cnc-supervised-recovery-flow';
import { runStartJobFlow } from './start-job-flow';

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
  bounds: { minX: 10, minY: 10, maxX: 70, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 50, y: 10 },
            { x: 70, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};
const completeRecoveryReview = {
  uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
  qualificationId: 'air-cut-2026-07-15',
  cutterClear: true,
  spindleStopped: true,
  positionRequalified: true,
  toolInspected: true,
  workholdingConfirmed: true,
  priorWorkConfirmed: true,
  clearedPathConfirmed: true,
} as const;

function recoveryProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
}

function configureReadyCncRecovery(): void {
  useStore.setState({
    project: recoveryProject(),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSettings: { maxPowerS: 12_000, minPowerS: 0, laserModeEnabled: false },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workZReferenceEpoch: 7,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: 7,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
    },
    startJob: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  configureReadyCncRecovery();
  vi.mocked(jobAwareAlert).mockClear();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('runCncSupervisedRecoveryFlow', () => {
  it('starts a newly generated job after every proof and ordinary Start gate passes', async () => {
    await runStartJobFlow();
    const originalStart = vi.mocked(useLaserStore.getState().startJob);
    const originalGcode = originalStart.mock.calls[0]?.[0] ?? '';
    const checkpoint = readJobCheckpoint();
    if (checkpoint === null) throw new Error('Expected CNC checkpoint.');
    const startJob = vi.fn<(gcode: string, options?: object) => Promise<void>>(
      async () => undefined,
    );
    useLaserStore.setState({ startJob });

    const started = await runCncSupervisedRecoveryFlow(checkpoint, completeRecoveryReview);

    expect(started).toBe(true);
    expect(startJob).toHaveBeenCalledTimes(1);
    const recoveryGcode = startJob.mock.calls[0]?.[0] ?? '';
    expect(recoveryGcode).not.toBe(originalGcode);
    expect(recoveryGcode).toContain('G0 Z3.810');
    expect(recoveryGcode).toContain('M3 S12000');
    expect(recoveryGcode).toContain('G0 X25.000 Y390.000');
    expect(recoveryGcode).toContain('G1 X50.000 Y390.000');
    expect(readJobCheckpoint()?.resumeInFlight).toBe(true);
    const options = startJob.mock.calls[0]?.[1] as
      | { readonly cncSetupAttestation?: CncSetupAttestation; readonly machineKind?: string }
      | undefined;
    expect(options?.machineKind).toBe('cnc');
    expect(
      cncSetupAttestationMatches(
        options?.cncSetupAttestation,
        recoveryGcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    ).toBe(true);
  });

  it('refuses recovery when physical cutter-clear review is incomplete', async () => {
    await runStartJobFlow();
    const checkpoint = readJobCheckpoint();
    if (checkpoint === null) throw new Error('Expected CNC checkpoint.');
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncSupervisedRecoveryFlow(checkpoint, {
      ...completeRecoveryReview,
      cutterClear: false,
    });

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('physically clear'));
  });

  it('refuses to reuse the original checkpoint after a recovery attempt started', async () => {
    await runStartJobFlow();
    const checkpoint = readJobCheckpoint();
    if (checkpoint === null) throw new Error('Expected CNC checkpoint.');
    writeJobCheckpoint(markResumeInFlight(checkpoint, '2026-07-15T01:00:00.000Z'));
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });

    const started = await runCncSupervisedRecoveryFlow(
      readJobCheckpoint() ?? checkpoint,
      completeRecoveryReview,
    );

    expect(started).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    expect(jobAwareAlert).toHaveBeenCalledWith(
      expect.stringContaining('original progress no longer identifies current work'),
    );
  });
});
