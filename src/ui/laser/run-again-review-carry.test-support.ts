// Shared scaffolding for the Run again carried-review tests (ADR-237
// Amendment 3): a small runnable laser job, a controller whose laser mode this
// session has verified, and an in-memory recovery repository.
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore, type StartJobOptions } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository, type LastCompletedReceipt } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { forgetSessionReviewedRuns } from '../state/session-reviewed-runs';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { captureJobReviewModels, useJobReviewStore, type JobReviewModel } from './job-review';
import { RUN_AGAIN_CARRIED_REVIEW_TOAST_KEY } from './run-again-review-carry';

export const NO_GO_WARNING = 'The Frame crosses "Clamp".';
// eslint-disable-next-line no-restricted-syntax -- scene DATA: fixture layer/object color key, not UI chrome (ADR-047).
const RED = '#ff0000';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

function runnableProject() {
  return {
    ...createProject(DEFAULT_DEVICE_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: RED,
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [{ ...createLayer({ id: 'red', color: RED }), power: 10 }],
    },
  };
}

/** A connected controller whose `$30`/`$32` this session has read and that
 * match the profile: Job Review shows "Laser mode verified". */
export function connectVerifiedLaser(controllerSessionEpoch: number): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSessionEpoch,
    controllerQualification: {
      kind: 'qualified',
      epoch: controllerSessionEpoch,
      settings: 'verified',
    },
    controllerSettings: {
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
      minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: controllerSessionEpoch, observedAt: 1 },
  });
}

/** What the controller boundary does once the first bytes are attempted. */
export async function committingStartJob(_gcode: string, options?: StartJobOptions): Promise<void> {
  options?.onStartCommitted?.(options.runId ?? '', 1);
}

/** A framed, verified laser job on controller session 7 and an empty
 * repository. `startJob` stands in for the controller. */
export async function arrangeFramedLaserJob(
  startJob: ReturnType<typeof useLaserStore.getState>['startJob'],
): Promise<RecoveryRepository> {
  localStorage.clear();
  resetStore();
  forgetSessionReviewedRuns();
  useToastStore.setState({ toasts: [] });
  useStore.setState({ project: runnableProject() });
  useLaserStore.setState({ ...initialLaserState(), startJob });
  connectVerifiedLaser(7);
  await installReviewPendingFramedRunPermitForCurrentState();
  useJobReviewStore.getState().close();
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  return repository;
}

/** Let the started run finish and hand back the receipt Run again repeats. The
 * stubbed controller does not spend the permit, so spend it as the real Start
 * boundary does; the completed Frame stays (ADR-565). */
export async function finishActiveRun(
  repository: RecoveryRepository,
): Promise<LastCompletedReceipt> {
  const active = repository.getSnapshot().activeRun;
  if (active === null) throw new Error('Expected a started run.');
  await repository.completeRun(active.runId);
  const receipt = repository.getSnapshot().lastCompletedReceipt;
  if (receipt === null) throw new Error('Expected a completed receipt.');
  useLaserStore.setState({ framedRun: null });
  return receipt;
}

/** Frame the current job again; `frameNoGoWarnings` is what that Frame's own
 * route disclosed, which Job Review shows as warnings. */
export async function frameAgain(frameNoGoWarnings?: ReadonlyArray<string>) {
  const permit = await installReviewPendingFramedRunPermitForCurrentState();
  if (frameNoGoWarnings === undefined) return permit;
  const framed = { ...permit, candidate: { ...permit.candidate, frameNoGoWarnings } };
  useLaserStore.setState({ framedRun: framed, completedFrame: framed });
  return framed;
}

/** Runs `action` and reports the Job Reviews it showed. */
export async function reviewsShownBy(
  action: () => Promise<unknown>,
): Promise<ReadonlyArray<JobReviewModel>> {
  const shown = captureJobReviewModels();
  try {
    await action();
  } finally {
    shown.stop();
  }
  return shown.models;
}

export function carriedNotices(): ReadonlyArray<string> {
  return useToastStore
    .getState()
    .toasts.filter((toast) => toast.key === RUN_AGAIN_CARRIED_REVIEW_TOAST_KEY)
    .map((toast) => toast.message);
}
