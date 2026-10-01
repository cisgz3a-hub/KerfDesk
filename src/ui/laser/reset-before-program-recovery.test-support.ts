import { grblDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { consumeControllerCommandResponse } from '../state/laser-interactive-command';
import { jobActions } from '../state/laser-job-actions';
import { flushResetCleanup } from '../state/laser-reset-cleanup';
import { LASER_START_OVERRIDE_RESET } from '../state/laser-start-override-reset';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryStorageBackend,
  MemoryRecoveryGenerationStore,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { prepareStartJob } from './start-job-readiness';

export const RESET_BOUNDARY_NOW = '2026-09-22T00:00:00.000Z';
export const RESET_BOUNDARY_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};

export function installResetBoundaryState(): void {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: RESET_BOUNDARY_STATUS,
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
  });
}

export function installResetBoundaryFailure(mode: 'reject' | 'hold', closeBeforeRejection = false) {
  const writes: string[] = [];
  const errors: Error[] = [];
  let signal = (): void => undefined;
  let release = (): void => undefined;
  let rejectReset = (_error: Error): void => undefined;
  const resetWritten = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const pending = new Promise<void>((resolve, reject) => {
    release = resolve;
    rejectReset = reject;
  });
  const refs: Parameters<typeof jobActions>[2] = {
    driver: grblDriver,
    controllerCommand: null,
    controllerIdleWait: null,
    controllerResetWait: null,
    controllerStatusWait: null,
    pauseResumeTransition: null,
    pendingResetCleanup: null,
    qualificationTimer: null,
    qualificationDeadline: null,
    runControllerQualification: null,
    writeEpoch: 0,
    untrackedAckReservations: [],
  };
  const safeWrite = async (data: string): Promise<void> => {
    writes.push(data);
    if (data === `${grblDriver.commands.settleDwell}\n`) {
      consumeControllerCommandResponse(refs, { kind: 'ok' }, 'ok');
      return;
    }
    if (data === LASER_START_OVERRIDE_RESET) {
      signal();
      if (mode === 'hold') {
        await pending;
        return;
      }
      if (closeBeforeRejection) {
        useLaserStore.setState({
          streamer: null,
          activeRunId: null,
          connection: { kind: 'disconnected' },
        });
      }
      throw new Error('Standalone override reset failed before the first program attempt.');
    }
    if (data === grblDriver.realtime.softReset) {
      flushResetCleanup(refs, safeWrite);
      return;
    }
    if (data === 'M5\n' || data === 'M9\n') return;
    throw new Error(`Unexpected program write: ${data}`);
  };
  const actions = jobActions(
    useLaserStore.setState,
    useLaserStore.getState,
    refs,
    safeWrite,
    () => grblDriver,
  );
  useLaserStore.setState({
    startJob: async (...args) => {
      try {
        await actions.startJob(...args);
      } catch (error) {
        if (error instanceof Error) errors.push(error);
        throw error;
      }
    },
  });
  return { writes, errors, resetWritten, release, rejectReset, actions };
}

export async function resetBoundaryRecoveryFixture() {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: {
      // eslint-disable-next-line no-restricted-syntax -- Fixture scene colour, not UI chrome.
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
              // eslint-disable-next-line no-restricted-syntax -- Fixture scene colour, not UI chrome.
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                    { x: 8, y: 8 },
                    { x: 2, y: 2 },
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
  const prepared = prepareStartJob(
    project,
    useLaserStore.getState().controllerSettings,
    { statusReport: RESET_BOUNDARY_STATUS, alarmCode: null, hasActiveStreamer: false },
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'previous-run',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    canvasPlan: prepared.canvasPlan,
    controllerSettings: useLaserStore.getState().controllerSettings,
    controllerObservation: { statusReport: RESET_BOUNDARY_STATUS, wco: RESET_BOUNDARY_STATUS.wco },
  });
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => RESET_BOUNDARY_NOW,
  });
  const staged = await repository.stageArtifact(artifact);
  if (!staged.ok) throw new Error('Expected the original artifact to stage.');
  await repository.activateFreshRun(artifact.runId);
  await repository.interruptRun(artifact.runId, 5, {
    kind: 'disconnect',
    message: 'Original disconnect.',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected the original recovery capsule.');
  const first = prepared.canvasPlan.manifest.blocks.find((block) => block.kind === 'process');
  if (first === undefined) throw new Error('Expected process movement.');
  return { project, prepared, artifact, repository, capsule, fromLine: first.rawLineIndex + 1 };
}
