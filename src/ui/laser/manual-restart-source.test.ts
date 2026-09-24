// Controller audit recovery-4: a manual Start from line on a Current Position
// job recompiled around the stopped head, so the rest of the job burned
// offset. It now reuses the placement of the newest run the project
// reproduces exactly, and says so; with none it says the restart anchors at
// the head as it is now.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import {
  forgetManualRestartsForTests,
  noteManualRestartStarted,
  prepareManualRestartSource,
} from './manual-restart-source';
import { prepareStartJob } from './start-job-readiness';
import { prepareRecoverySource } from './start-job-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const NOW = '2026-09-24T00:00:00.000Z';
const CURRENT_POSITION = { startFrom: 'current-position', anchor: 'front-left' } as const;

function headAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    wco: { x: 0, y: 0, z: 0 },
    feed: 0,
    spindle: 0,
  };
}

function lineProject(): Project {
  const base = createProject();
  return {
    ...base,
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

function moveHead(x: number, y: number): void {
  useLaserStore.setState({ statusReport: headAt(x, y) });
}

function emptyRepository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
}

// A Current Position run started with the head at (5, 5), then interrupted.
async function interruptedRunAt5x5() {
  moveHead(5, 5);
  const project = useStore.getState().project;
  const laser = useLaserStore.getState();
  const prepared = prepareStartJob(
    project,
    laser.controllerSettings,
    { statusReport: laser.statusReport, alarmCode: null, hasActiveStreamer: false },
    CURRENT_POSITION,
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'current-position-run',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    canvasPlan: prepared.canvasPlan,
    controllerSettings: laser.controllerSettings,
    controllerObservation: { statusReport: laser.statusReport, wco: { x: 0, y: 0, z: 0 } },
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
  });
  const repository = emptyRepository();
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  await repository.activateFreshRun(artifact.runId);
  await repository.interruptRun(artifact.runId, 2, { kind: 'disconnect', message: 'Cable.' });
  return { artifact, repository };
}

beforeEach(() => {
  forgetManualRestartsForTests();
  useStore.setState({ project: lineProject(), jobPlacement: CURRENT_POSITION });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: headAt(0, 0),
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
  });
});

afterEach(() => {
  useStore.setState({ project: createProject() });
  useLaserStore.setState(initialLaserState());
  vi.clearAllMocks();
});

describe('manual restart placement', () => {
  it('anchors a Current Position job where the interrupted run started, not at the stopped head', async () => {
    const { artifact, repository } = await interruptedRunAt5x5();
    moveHead(20, 20);

    const restart = await prepareManualRestartSource(repository);

    expect(restart?.source.gcode).toBe(artifact.gcode);
    expect(restart?.placementNote).toContain('Current Position X 5.0, Y 5.0 mm');
    // The live placement would have anchored the job at the stopped head.
    expect((await prepareRecoverySource())?.gcode).not.toBe(artifact.gcode);
  });

  it('says a restart with no earlier run is anchored at the head as it is now', async () => {
    moveHead(20, 20);

    const restart = await prepareManualRestartSource(emptyRepository());

    expect(restart?.placementNote).toContain('anchored at the head as it is now (X 20.0, Y 20.0');
  });

  it('keeps the first placement for a second manual restart', async () => {
    const { artifact, repository } = await interruptedRunAt5x5();
    moveHead(20, 20);
    const first = await prepareManualRestartSource(repository);
    if (first === null) throw new Error('Expected a restart source.');
    noteManualRestartStarted(first, '2026-09-24T00:05:00.000Z');
    // The first restart superseded the recovery record, and the head moved again.
    moveHead(30, 30);

    const second = await prepareManualRestartSource(emptyRepository());

    expect(second?.source.gcode).toBe(artifact.gcode);
  });
});
