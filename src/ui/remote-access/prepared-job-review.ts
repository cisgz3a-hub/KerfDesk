import { currentOutputScope } from '../state/output-scope-state';
import { useStore, type AppState } from '../state/store';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useCameraStore } from '../state/camera-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { completedFrameRunIsOwned } from '../state/completed-frame-run';
import { isStampedStartRun } from '../state/framed-run-interruption';
import { jobStartMarkAcceptsStatus, jobStartMarkOwnsFrame } from '../state/job-start-mark';
import { currentCompletedFrame, framedRunReadinessIssue } from '../laser/framed-run-readiness';
import { transientMachineActivity } from '../laser/framed-run-invalidation';
import { preparedMatchesCompletedFrame } from '../laser/framed-start-preparation';
import { currentReplayExecutionSignature } from '../laser/start-job-execution-tracking';
import { startPreparationCoordinateKey } from '../laser/start-preparation-coordinate-key';
import { startMachineInputsKey, startPreparationIsTimeBound } from '../laser/start-job-source';
import { currentReviewedJobSnapshot } from '../laser/job-review/reviewed-job-snapshot';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { remoteBounds } from '../remote-control/projections';
import type { SafeRemoteJobReview } from '../remote-control/types';
import type { ReviewedStartBundle } from '../laser/job-review/job-review-gate';
import { prepareRemoteJobReview } from './job-review-preparation';
import { RemoteFault } from '../remote-control/fault';

type Preparation = Awaited<ReturnType<typeof prepareRemoteJobReview>>;
type ReadyPreparation = Extract<Preparation, { readonly ok: true }>;
type ReviewBase = Pick<SafeRemoteJobReview, 'revision' | 'mode' | 'warnings' | 'frame'>;

/** Reuses the desktop owner or compiles a read-only review. It never starts a job. */
export async function preparedJobReview(
  revision: string,
  signal?: AbortSignal,
): Promise<SafeRemoteJobReview> {
  if (signal?.aborted === true) throw new RemoteFault('cancelled');
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const mode = app.project.machine?.kind ?? 'laser';
  const complete = spatialFrameComplete(app, laser);
  const base = {
    revision,
    mode,
    warnings: [],
    frame: { required: true as const, complete },
  };
  if (reviewIsPreparing())
    return {
      ...base,
      status: 'preparing',
      message:
        'The desktop is preparing the current job. Request its review again after preparation finishes.',
    };
  const published = currentReviewedJobSnapshot();
  const reuse =
    published !== null &&
    !startPreparationIsTimeBound(app.project) &&
    snapshotMatchesCurrent(published, app, laser);
  const preparation = reuse
    ? {
        ok: true as const,
        bundle: published.bundle,
        model: published.model,
        machineInputsKey: published.machineInputsKey,
      }
    : await prepareRemoteJobReview(app, laser, signal);
  if (!preparation.ok) return unavailablePreparation(base, preparation);
  const latestApp = useStore.getState();
  const latestLaser = useLaserStore.getState();
  if (!snapshotMatchesCurrent(preparation, latestApp, latestLaser))
    return {
      ...base,
      status: 'unavailable',
      frame: { required: true, complete: spatialFrameComplete(latestApp, latestLaser) },
      message: 'The workspace or machine observations changed. Request a fresh job review.',
    };
  return readyReview(base, preparation, reuse, latestApp, latestLaser);
}

function reviewIsPreparing(): boolean {
  const review = useJobReviewStore.getState();
  return (
    useFramePreparationStore.getState().pending ||
    (review.state.kind === 'open' && review.state.isPreparing)
  );
}

function unavailablePreparation(
  base: ReviewBase,
  preparation: Extract<Preparation, { readonly ok: false }>,
): SafeRemoteJobReview {
  return {
    ...base,
    status: preparation.status,
    frame: {
      required: true,
      complete: spatialFrameComplete(useStore.getState(), useLaserStore.getState()),
    },
    warnings: preparation.messages.map((message, index) => ({
      code: `preparation-${index + 1}`,
      message,
      severity: 'warning' as const,
    })),
    message:
      preparation.status === 'preparing'
        ? 'The current program is being prepared. Request a fresh review shortly.'
        : 'The current program could not be prepared. These facts do not approve or start a job.',
  };
}

function readyReview(
  base: ReviewBase,
  current: ReadyPreparation,
  reuse: boolean,
  app: AppState,
  laser: LaserState,
): SafeRemoteJobReview {
  const frame = currentCompletedFrame(laser);
  const prepared = current.bundle.prepared;
  const metrics = prepared.metrics;
  const bounds = metrics.jobBounds === null ? undefined : remoteBounds(metrics.jobBounds);
  return {
    ...base,
    status: 'ready',
    summary: {
      artworkCount: current.bundle.project.scene.objects.length,
      operationCount: current.bundle.project.scene.layers.length,
      ...(metrics.duration.unavailableReason === undefined
        ? { estimatedSeconds: metrics.duration.totalSeconds }
        : {}),
      ...(bounds === undefined ? {} : { bounds }),
    },
    warnings: current.model.warnings.map((message, index) => ({
      code: `job-review-${index + 1}`,
      message,
      severity: 'warning' as const,
    })),
    frame: {
      required: true,
      complete:
        spatialFrameComplete(app, laser) &&
        frame !== null &&
        preparedMatchesCompletedFrame(frame, prepared),
    },
    message: reuse
      ? 'Warnings, time and bounds describe the program displayed in desktop Job Review. Artwork and operation counts are workspace totals. This read does not approve or start the job.'
      : 'Warnings, time and bounds describe the current prepared program. Artwork and operation counts are workspace totals. This read does not open a dialog, approve, Frame or start the job.',
  };
}

function snapshotMatchesCurrent(
  current: { readonly bundle: ReviewedStartBundle; readonly machineInputsKey: string },
  app: AppState,
  laser: LaserState,
): boolean {
  const bundle = current.bundle;
  if (bundle.project !== app.project || bundle.app.project !== app.project) return false;
  const signature = currentReplayExecutionSignature(app);
  if (
    signature !== currentReplayExecutionSignature(bundle.app) ||
    signature !== bundle.prepared.canvasPlan.retentionKey
  )
    return false;
  if (
    JSON.stringify(currentOutputScope(app)) !==
    JSON.stringify(bundle.outputScope ?? currentOutputScope(bundle.app))
  )
    return false;
  if (
    current.machineInputsKey !==
    startMachineInputsKey(app.project, laser, useCameraStore.getState())
  )
    return false;
  const placement = {
    jobPlacement: app.jobPlacement,
    ...(bundle.prepared.jobOrigin === undefined
      ? {}
      : { resolvedJobOrigin: bundle.prepared.jobOrigin }),
  };
  return (
    startPreparationCoordinateKey(app.project.device, bundle.laser, placement) ===
    startPreparationCoordinateKey(app.project.device, laser, placement)
  );
}

/** Mirror the existing spatial-evidence reader, including its owned run/mark excursion. */
function spatialFrameComplete(app: AppState, laser: LaserState): boolean {
  const frame = currentCompletedFrame(laser);
  if (frame === null || frame.candidate.authorizationContext !== undefined) return false;
  const owned = ownedFrameExcursion(laser, frame);
  const expectedStart = isStampedStartRun(laser, laser.statusReport);
  return (
    laser.frameVerification === frame.candidate.frameVerification &&
    !laser.autofocusBusy &&
    laser.motionOperation === null &&
    laser.alarmCode === null &&
    !laser.mpgActive &&
    (owned || !transientMachineActivity(laser, expectedStart)) &&
    framedRunReadinessIssue(frame, app, laser, {
      ignoreControllerStatusState: owned || expectedStart,
      ignoreControllerPosition: owned,
    }) === null
  );
}

function ownedFrameExcursion(
  laser: LaserState,
  frame: NonNullable<ReturnType<typeof currentCompletedFrame>>,
): boolean {
  return (
    (completedFrameRunIsOwned(laser) && laser.streamer?.status !== 'errored') ||
    (jobStartMarkOwnsFrame(laser, frame) && jobStartMarkAcceptsStatus(laser, laser.statusReport))
  );
}
