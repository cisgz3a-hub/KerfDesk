// A sealed laser recovery finishes the part its interrupted run started. The
// interrupted run consumed no serial number or CSV record, so the recovery
// that completes the part consumes one, as Start would have; otherwise the
// next job burns the same serial again (oracle audit O1, O5-P1-1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step, type StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { runStartJobFlow } from './start-job-flow';
import { cancelVariableStreamAdvancement } from './variable-stream-advancement';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const CONTROLLER_EPOCH = 9;
let uninstallAutoReview: () => void = () => undefined;
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
  id: 'recovery-line',
  source: 'recovery-line.svg',
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
const advance = vi.fn();
const started = step(createStreamer('G1 X1')).state;

function variableProject(): Project {
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  return {
    ...base,
    variables: { recordIndex: 0, serialValue: 41, advancement: 'after-successful-stream' },
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
}

beforeEach(async () => {
  resetStore();
  advance.mockClear();
  useStore.setState({
    project: variableProject(),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    advanceVariablesAfter: advance,
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: CONTROLLER_EPOCH,
    controllerQualification: { kind: 'qualified', epoch: CONTROLLER_EPOCH, settings: 'verified' },
    statusReport: idleStatus,
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  await installFramedRunPermitForCurrentState();
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useJobReviewStore.getState().close();
  uninstallAutoReview = installAutoJobReview('confirm');
});

afterEach(() => {
  cancelVariableStreamAdvancement();
  uninstallAutoReview();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('a completed laser recovery advances variable data once', () => {
  it('advances the serial after the recovery that finishes the interrupted part', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    expect(advance).not.toHaveBeenCalled();
    useLaserStore.setState({ startJob: streamingStart() });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(true);
    finishCleanly();

    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith(
      useStore.getState().project,
      'successful-stream',
      capsule.artifact.outputScope,
    );
  });

  it('consumes nothing when the recovery stops before it finishes', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    useLaserStore.setState({ startJob: streamingStart() });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(true);
    useLaserStore.setState({ streamer: { ...started, status: 'errored' } });
    useLaserStore.setState({ streamer: null });

    expect(advance).not.toHaveBeenCalled();
  });

  it('consumes nothing when the open project no longer holds the run’s values', async () => {
    const repository = recoveryHarness();
    const capsule = await interruptedCapsule(repository);
    // The operator pressed Next after the interruption.
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, variables: { ...project.variables!, serialValue: 42 } },
    });
    useLaserStore.setState({ startJob: streamingStart() });

    expect(await runLaserRecoveryCapsuleFlow(capsule, repository)).toBe(true);
    finishCleanly();

    expect(advance).not.toHaveBeenCalled();
  });
});

/** A recovery Start that creates its streamer under the recovery's run ID. */
function streamingStart() {
  return vi.fn(async (_gcode: string, options?: StartJobOptions) => {
    useLaserStore.setState((state) => ({
      activeRunId: options?.runId ?? null,
      streamerEpoch: state.streamerEpoch + 1,
      streamer: started,
    }));
  });
}

// A clean finish: the post-job settle waits for Idle, and an Idle report
// from the connected controller releases the stream.
function finishCleanly(): void {
  useLaserStore.setState({
    streamer: { ...started, status: 'done' },
    controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 0 },
  });
  useLaserStore.setState({
    streamer: null,
    controllerOperation: null,
    connection: { kind: 'connected' },
    statusReport: idleStatus,
  });
}

function recoveryHarness(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
}

async function interruptedCapsule(repository: RecoveryRepository): Promise<RecoveryCapsule> {
  await runStartJobFlow(repository);
  const active = repository.getSnapshot().activeRun;
  if (active === null) throw new Error('Expected an active exact run.');
  // The original run never streamed here, so its advancement observer is
  // still waiting; the interruption retires it as a disconnect would.
  cancelVariableStreamAdvancement();
  await repository.interruptRun(active.runId, 0, {
    kind: 'disconnect',
    message: 'Test interruption',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected an exact recovery capsule.');
  return capsule;
}
