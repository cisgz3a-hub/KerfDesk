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
import { useCameraStore } from '../state/camera-store';
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
  type LegacyCheckpointStorage,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { installFramedRunPermitForCurrentState } from './framed-run-testing';
import { useStartBlockerStore } from './start-blocker-store';
import { runStartJobFlow } from './start-job-flow';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { prepareCurrentStartJob, prepareRecoverySource } from './start-job-source';

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
  id: 'claim-line',
  source: 'claim-line.svg',
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

function recoveryRepository(): RecoveryRepository {
  const legacyStorage: LegacyCheckpointStorage = { read: () => null, clear: () => undefined };
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage,
  });
}

function pauseNextArtifactStage(repository: RecoveryRepository) {
  const originalStage = repository.stageArtifact.bind(repository);
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stage = vi.spyOn(repository, 'stageArtifact').mockImplementationOnce(async (artifact) => {
    await gate;
    return originalStage(artifact);
  });
  return { stage, release };
}

async function startAcceptedFramedRun(): Promise<{
  readonly connection: FakeConnection;
  readonly verification: NonNullable<
    ReturnType<typeof useLaserStore.getState>['frameVerification']
  >;
}> {
  const connection = makeConnection(async () => undefined);
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  await connectWith(connection);
  const controllerSessionEpoch = useLaserStore.getState().controllerSessionEpoch;
  useLaserStore.setState({
    statusReport: idleStatus,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: controllerSessionEpoch, observedAt: 1 },
    controllerQualification: {
      kind: 'qualified',
      epoch: controllerSessionEpoch,
      settings: 'verified',
    },
  });
  const permit = await installFramedRunPermitForCurrentState();

  await runStartJobFlow(recoveryRepository());

  const startedState = useLaserStore.getState();
  expect(
    startedState.streamer,
    [
      ...useStartBlockerStore.getState().messages,
      startedState.lastWriteError ?? '',
      ...startedState.log.slice(-5),
    ].join('\n'),
  ).not.toBeNull();
  expect(useLaserStore.getState().framedRun).toBeNull();
  expect(useLaserStore.getState().frameVerification).toBe(permit.candidate.frameVerification);
  return { connection, verification: permit.candidate.frameVerification };
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.clear();
  resetStore();
  const project = {
    ...createProject({ ...DEFAULT_DEVICE_PROFILE, streamingMode: 'ping-pong' as const }),
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  useStore.setState({ project, selectedObjectId: null, additionalSelectedIds: new Set() });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSessionEpoch: 7,
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    startJob: vi.fn(async () => undefined),
  });
  await installFramedRunPermitForCurrentState();
  ensureFramedRunInvalidationSubscriptions();
  useStartBlockerStore.getState().clear();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('ordinary framed Start permit claim', () => {
  it('keeps and starts a completed permit across an advisory settings and build-info refresh', async () => {
    const permit = useLaserStore.getState().framedRun;
    if (permit === null) throw new Error('Expected a framed-run permit.');

    // readMachineSettings clears both observations before installing fresh
    // objects. Neither phase may turn advisory $30/$32/$I evidence into a
    // second physical-Frame requirement.
    useLaserStore.setState({
      controllerSettings: null,
      controllerSettingsObservation: null,
      controllerBuildInfo: null,
      controllerBuildInfoObservation: null,
    });
    expect(useLaserStore.getState().framedRun).toBe(permit);

    useLaserStore.setState({
      controllerSettings: { maxPowerS: 255, laserModeEnabled: false },
      controllerSettingsObservation: { sessionEpoch: 7, observedAt: 2 },
      controllerBuildInfo: {
        protocolVersion: '1.1h',
        buildRevision: '20190830',
        userInfo: '',
        optionCodes: ['V'],
        plannerBufferBlocks: 15,
        rxBufferBytes: 128,
      },
      controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 2 },
    });
    expect(useLaserStore.getState().framedRun).toBe(permit);

    await runStartJobFlow(recoveryRepository());

    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
  });

  it('still revokes a completed permit when the controller session changes', () => {
    useLaserStore.setState({ controllerSessionEpoch: 8 });

    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('refuses a permit revoked while exact-artifact staging is pending', async () => {
    const repository = recoveryRepository();
    const paused = pauseNextArtifactStage(repository);
    const start = runStartJobFlow(repository);
    await vi.waitFor(() => expect(paused.stage).toHaveBeenCalledTimes(1));

    useLaserStore.setState({ framedRun: null, frameVerification: null });
    paused.release();
    await start;

    expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
    expect(useStartBlockerStore.getState().messages.join(' ')).toContain(
      'Frame permit was consumed, replaced, or revoked',
    );
  });

  it('allows only one async owner to claim the same permit', async () => {
    const repository = recoveryRepository();
    const permit = useLaserStore.getState().framedRun;
    const paused = pauseNextArtifactStage(repository);
    const first = runStartJobFlow(repository);
    await vi.waitFor(() => expect(paused.stage).toHaveBeenCalledTimes(1));

    await runStartJobFlow(repository);
    expect(paused.stage).toHaveBeenCalledTimes(1);

    paused.release();
    await first;
    expect(useLaserStore.getState().startJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[1]?.framedRunPermit).toBe(
      permit,
    );
  });

  it('fails the final boundary when the claimed permit identity is replaced', async () => {
    const repository = recoveryRepository();
    let enterBoundary = (): void => undefined;
    let releaseBoundary = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      enterBoundary = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseBoundary = resolve;
    });
    let wouldStream = false;
    const startJob = vi.fn(async (_gcode: string, options: StartJobOptions = {}) => {
      enterBoundary();
      await gate;
      options.assertFinalStartAuthorized?.();
      wouldStream = true;
    });
    useLaserStore.setState({ startJob });

    const start = runStartJobFlow(repository);
    await entered;
    const permit = useLaserStore.getState().framedRun;
    if (permit === null) throw new Error('Expected the claimed permit to remain live.');
    useLaserStore.setState({
      framedRun: { ...permit, completedStatusSequence: permit.completedStatusSequence + 1 },
    });
    releaseBoundary();
    await start;

    expect(startJob).toHaveBeenCalledTimes(1);
    expect(wouldStream).toBe(false);
    expect(useStartBlockerStore.getState().messages.join(' ')).toContain(
      'Frame permit was consumed, replaced, or revoked',
    );
  });

  it('keeps the permit live through the final assertion and consumes it before streaming', async () => {
    const permit = useLaserStore.getState().framedRun;
    if (permit === null) throw new Error('Expected a framed-run permit.');
    const laserModeStartEvidence = permit.candidate.laserModeStartEvidence;
    if (laserModeStartEvidence === undefined) {
      throw new Error('Expected the laser fixture to retain reviewed Start evidence.');
    }
    const finalAssertion = vi.fn(() => {
      expect(useLaserStore.getState().framedRun).toBe(permit);
    });
    useLaserStore.setState({ startJob: originalStartJob });

    await expect(
      useLaserStore.getState().startJob('G21\nG90\nM5\n', {
        framedRunPermit: permit,
        assertFinalStartAuthorized: finalAssertion,
        laserModeStartEvidence,
      }),
    ).rejects.toThrow('No active serial connection');

    expect(finalAssertion).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('retains verification after a real accepted Start for recovery and completed-replay preparation', async () => {
    const { verification } = await startAcceptedFramedRun();
    try {
      // Model the settled post-run state. The real store-level Start above has
      // already created the streamer and handed the exact bytes to transport.
      useLaserStore.setState({ streamer: null, activeRunId: null });

      const recovery = prepareRecoverySource();
      const replay = await prepareCurrentStartJob(
        useStore.getState(),
        useLaserStore.getState(),
        useCameraStore.getState(),
      );

      expect(useLaserStore.getState().frameVerification).toBe(verification);
      expect(recovery).not.toBeNull();
      expect(replay.ok).toBe(true);
    } finally {
      await useLaserStore.getState().disconnect();
    }
  });

  it('still invalidates retained verification on post-Start manual motion', async () => {
    await startAcceptedFramedRun();
    try {
      useLaserStore.setState({ streamer: null, activeRunId: null });

      await useLaserStore.getState().jog({ dx: 1, feed: 500 });

      expect(useLaserStore.getState().frameVerification).toBeNull();
    } finally {
      await useLaserStore.getState().disconnect();
    }
  });

  it('does not revoke a stamped Start-owned Run status at the same position', async () => {
    const permit = useLaserStore.getState().framedRun;
    if (permit === null) throw new Error('Expected a framed-run permit.');
    const startJob = vi.fn(async (_gcode: string, options: StartJobOptions = {}) => {
      const statusSequence = useLaserStore.getState().statusSequence;
      useLaserStore.setState({
        controllerOperation: {
          kind: 'start-arming',
          phase: 'queue-fence',
          ownedRunStatusSequence: statusSequence,
          ownedRunPermit: permit,
        },
        statusReport: { ...idleStatus, state: 'Run' },
      });
      expect(useLaserStore.getState().framedRun).toBe(permit);
      useLaserStore.setState({ statusReport: idleStatus });
      options.assertFinalStartAuthorized?.();
    });
    useLaserStore.setState({ startJob });

    await runStartJobFlow(recoveryRepository());

    expect(startJob).toHaveBeenCalledTimes(1);
    expect(useStartBlockerStore.getState().messages).toEqual([]);
  });

  it.each(['Run', 'Hold', 'Jog', 'Door', 'Check', 'Home', 'Tool'] as const)(
    'revokes a claimed permit on unowned Start-arming %s even if Idle later matches',
    (state) => {
      useLaserStore.setState({
        controllerOperation: { kind: 'start-arming', phase: 'queue-fence' },
        statusReport: { ...idleStatus, state },
      });
      useLaserStore.setState({ statusReport: idleStatus });

      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().frameVerification).toBeNull();
    },
  );

  it('revokes an owned Start Run when the reported position changes', () => {
    const permit = useLaserStore.getState().framedRun;
    if (permit === null) throw new Error('Expected a framed-run permit.');
    useLaserStore.setState({
      controllerOperation: {
        kind: 'start-arming',
        phase: 'queue-fence',
        ownedRunStatusSequence: useLaserStore.getState().statusSequence,
        ownedRunPermit: permit,
      },
      statusReport: {
        ...idleStatus,
        state: 'Run',
        mPos: { x: 1, y: 0, z: 0 },
      },
    });

    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });
});
