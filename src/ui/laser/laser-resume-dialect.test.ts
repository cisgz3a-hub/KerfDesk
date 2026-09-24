// Controller audit recovery-3: the GRBL-dialect resume builder zeroed every
// power command of a Smoothieware (M221 scaling) or Marlin (M3 I / M106)
// program, so a resumed job ran dark. A new resume on those controllers is
// refused with that fact before anything is built or sent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, selectControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import type { ControllerKind } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { laserResumeDialectRefusal } from './laser-resume-program';
import { prepareStartJob } from './start-job-readiness';
import { streamResumeFromRawLine } from './start-job-resume-stream';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const NOW = '2026-09-24T00:00:00.000Z';
const STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};
const originalStartJob = useLaserStore.getState().startJob;

beforeEach(() => {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: STATUS,
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
  });
});

afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.clearAllMocks();
});

function lineProject(controllerKind: ControllerKind): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, controllerKind },
    scene: {
      layers: [createLayer({ id: 'line', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
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
        },
      ],
    },
  };
}

function prepared(controllerKind: ControllerKind) {
  const result = prepareStartJob(
    lineProject(controllerKind),
    useLaserStore.getState().controllerSettings,
    { statusReport: STATUS, alarmCode: null, hasActiveStreamer: false },
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!result.ok) throw new Error(result.messages.join('\n'));
  return result;
}

function lastAlert(): string {
  return String(vi.mocked(jobAwareAlert).mock.calls.at(-1)?.[0] ?? '');
}

describe('laserResumeDialectRefusal', () => {
  it('refuses the dialects whose power the builder cannot restore', () => {
    expect(laserResumeDialectRefusal('smoothieware')).toContain('M221 power scaling');
    expect(laserResumeDialectRefusal('marlin')).toContain('M106 fan power');
  });

  it('allows the GRBL family', () => {
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      expect(laserResumeDialectRefusal(kind)).toBeNull();
    }
  });
});

describe.each(['smoothieware', 'marlin'] as const)('resume on %s', (controllerKind) => {
  it('refuses Start from line before anything is sent', async () => {
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const job = prepared(controllerKind);

    const started = await streamResumeFromRawLine(
      job.prepared.project,
      job.gcode,
      3,
      job.canvasPlan,
      captureLaserModeStartSnapshot(useLaserStore.getState()),
    );

    expect(started).toBe(false);
    expect(lastAlert()).toContain('cannot build a correct resumed program');
    expect(startJob).not.toHaveBeenCalled();
  });

  it('refuses a saved recovery before anything is sent', async () => {
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    const job = prepared(controllerKind);
    const artifact = await createCurrentTestExecutionArtifact({
      runId: `interrupted-${controllerKind}`,
      gcode: job.gcode,
      prepared: job.prepared,
      canvasPlan: job.canvasPlan,
      controllerSettings: useLaserStore.getState().controllerSettings,
      controllerObservation: { statusReport: STATUS, wco: STATUS.wco },
    });
    const repository = new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => NOW,
    });
    expect((await repository.stageArtifact(artifact)).ok).toBe(true);
    await repository.activateFreshRun(artifact.runId);
    await repository.interruptRun(artifact.runId, 3, {
      kind: 'disconnect',
      message: 'Cable pulled.',
    });
    const capsule = repository.getSnapshot().recoveryCapsule;
    if (capsule === null) throw new Error('Expected a recovery capsule.');
    // The matching controller is connected and qualified.
    useLaserStore.setState({
      activeControllerKind: controllerKind,
      capabilities: selectControllerDriver(controllerKind).capabilities,
    });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(false);
    expect(lastAlert()).toContain('cannot build a correct resumed program');
    expect(startJob).not.toHaveBeenCalled();
  });
});
