import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { machineKindOf } from '../../core/scene';
import { focusJogReady } from '../laser/FocusJogControls';
import { currentCompletedFrame, framedRunReadinessIssue } from '../laser/framed-run-readiness';
import { currentWorkXy } from '../laser/frame-dispatch-support';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { currentWorkZMm } from '../state/infer-machine-position';
import { finite } from './validation';
import {
  activeJobCommandBlockMessage,
  isActiveJob,
  jogFrameCommandBlockMessage,
} from '../state/laser-store-helpers';
import { hasPendingControllerWrite } from '../state/laser-start-queue-fence';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { reviewMessageProjector } from './review-message-sharing';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { RemoteControlOptions } from './types';
import type { MachineOperation, MachineReview, MachineReviewPageRequest } from './machine-types';
import { machineReviewPage } from './machine-review-pages';
import { RemoteFault } from './fault';
import { useCameraStore } from '../state/camera-store';
import { describeLiveJobTiming } from '../state/live-job-timing';

type Laser = ReturnType<typeof useLaserStore.getState>;
type App = ReturnType<typeof useStore.getState>;
export function machineStatusProjection(
  options: RemoteControlOptions,
  canControl: boolean,
): Record<string, unknown> {
  const app = (options.store ?? useStore).getState();
  const laser = useLaserStore.getState();
  const mode = machineKindOf(app.project.machine);
  return {
    permissions: { canControl },
    mode,
    connection: connectionState(laser),
    controllerState: laser.statusReport?.state ?? null,
    ...positionProjection(laser),
    jog: {
      xySupported: laser.capabilities.jog !== 'none',
      zSupported: laser.capabilities.jog !== 'none' && focusJogReady(app.project.device, mode),
      maxFeedMmPerMin: deviceForActiveHead(app.project.device, app.project.machine).maxFeed,
      holdSupported: laser.capabilities.jog !== 'none' && laser.capabilities.jogCancel,
    },
    frame: {
      required: true,
      complete: framedRunReadinessIssue(currentCompletedFrame(laser), app, laser) === null,
    },
    job: { ...jobProjection(laser), ...jobTiming(laser) },
    homing: !laser.capabilities.homing
      ? 'not_supported'
      : laser.homingState === 'confirmed'
        ? 'confirmed'
        : 'unknown',
    camera: { available: useCameraStore.getState().sourceState.kind === 'live' },
    motion: { kind: motionKind(laser) },
    availability: {
      ...availabilityProjection(app, laser, canControl),
      ...extendedAvailability(laser, canControl),
    },
  };
}
function jobTiming(laser: Laser): Record<string, number> {
  const run = laser.liveCanvasRun;
  if (run == null || run.timing === undefined || !isActiveJob(laser.streamer)) return {};
  const now = Date.now();
  const display = describeLiveJobTiming(run.timing, now);
  const elapsed = (now - run.startedAtMs) / 1000;
  const remaining = 'remainingSeconds' in display ? display.remainingSeconds : undefined;
  return {
    ...(finite(elapsed, 0, 31_536_000) ? { elapsedSeconds: Math.round(elapsed) } : {}),
    ...(finite(remaining, 0, 31_536_000)
      ? { remainingSeconds: Math.round(remaining as number) }
      : {}),
  };
}
/** The first refusal reason that applies, or available. */
const firstReason = (...reasons: (string | null)[]) =>
  available(reasons.find((reason) => reason !== null) ?? null);

/** Shared refusal reasons for the ADR-585 actions, each null when it does not apply. */
function actionGates(laser: Laser, canControl: boolean) {
  const approval = canControl ? null : 'Approve machine control on the computer first.';
  const offline =
    laser.connection.kind === 'connected' ? null : 'Connect the machine on the computer first.';
  const active = isActiveJob(laser.streamer);
  return {
    approval,
    offline,
    general: approval ?? offline ?? jogFrameCommandBlockMessage(laser),
    busy:
      active || laser.motionOperation !== null
        ? 'Wait for the current job or motion to finish.'
        : null,
    streaming: active && laser.streamer?.status === 'streaming',
    paused: laser.streamer?.status === 'paused',
    disconnected: laser.connection.kind === 'disconnected' || laser.connection.kind === 'failed',
  };
}

/** ADR-585 actions. Reasons are fixed strings; the desktop action rechecks every guard. */
function extendedAvailability(laser: Laser, canControl: boolean) {
  const gate = actionGates(laser, canControl);
  const homing = laser.capabilities.homing ? null : 'This controller has no homing command.';
  const cancel = laser.capabilities.jogCancel
    ? null
    : 'This controller cannot stop a jog early; use steps.';
  return {
    connect: firstReason(
      gate.approval,
      gate.disconnected ? null : 'The machine is already connected.',
    ),
    disconnect: firstReason(gate.approval, gate.offline, gate.busy),
    home: firstReason(gate.general, gate.busy, homing),
    origin: firstReason(gate.general, gate.busy),
    pause: firstReason(
      gate.approval,
      gate.offline,
      gate.streaming ? null : 'No running job to pause.',
    ),
    resume: firstReason(
      gate.approval,
      gate.offline,
      gate.paused ? null : 'No paused job to resume.',
    ),
    hold: firstReason(gate.general, gate.busy, cancel),
  };
}
function connectionState(laser: Laser) {
  return laser.connection.kind === 'connected'
    ? 'connected'
    : laser.connection.kind === 'connecting'
      ? 'connecting'
      : 'disconnected';
}
function motionKind(laser: Laser) {
  if (laser.motionOperation !== null) return laser.motionOperation.kind;
  return ['Run', 'Jog', 'Home', 'Hold', 'Door'].includes(laser.statusReport?.state ?? '')
    ? 'unknown'
    : 'idle';
}
function positionProjection(laser: Laser): Record<string, unknown> {
  const xy = currentWorkXy(laser);
  if (xy === undefined || !finite(xy.x, -100_000, 100_000) || !finite(xy.y, -100_000, 100_000))
    return {};
  const z = currentWorkZMm(
    laser.statusReport,
    laser.wcoCache,
    laser.controllerSettings?.reportInches === true,
  );
  return {
    position: {
      space: 'work',
      ...(laser.activeWcs === null ? {} : { wcs: laser.activeWcs }),
      xMm: xy.x,
      yMm: xy.y,
      ...(finite(z, -100_000, 100_000) ? { zMm: z } : {}),
    },
  };
}
function jobProjection(laser: Laser): Record<string, unknown> {
  const stream = laser.streamer;
  const active = isActiveJob(stream);
  const progress =
    stream === null || stream.queued.length === 0
      ? null
      : (stream.completed / stream.queued.length) * 100;
  const state = jobState(laser, active);
  return { active, state, ...(finite(progress, 0, 100) ? { progressPercent: progress } : {}) };
}
function jobState(laser: Laser, active: boolean) {
  if (laser.controllerOperation?.kind === 'start-arming') return 'starting';
  if (!active) return 'idle';
  if (laser.streamer?.status === 'paused') return 'paused';
  if (laser.streamer?.status === 'tool-change') return 'tool_change';
  return laser.streamer?.status === 'streaming' ? 'running' : 'unknown';
}
function generalControlIssue(laser: Laser, canControl: boolean): string | null {
  if (!canControl) return 'Approve machine control on the computer first.';
  if (laser.connection.kind !== 'connected') return 'Connect the machine on the computer first.';
  return (
    jogFrameCommandBlockMessage(laser) ??
    (hasPendingControllerWrite(laser)
      ? 'Wait for the previous controller command to settle.'
      : null)
  );
}
function availabilityProjection(app: App, laser: Laser, canControl: boolean) {
  const general = generalControlIssue(laser, canControl);
  const preparation = useFramePreparationStore.getState().pending
    ? 'Wait for the current Frame to finish.'
    : null;
  const review =
    useJobReviewStore.getState().state.kind !== 'idle'
      ? 'A Job Review already owns this Start.'
      : null;
  const frame = framedRunReadinessIssue(currentCompletedFrame(laser), app, laser);
  const shared = general ?? preparation;
  const ordinaryJob = shared ?? activeJobCommandBlockMessage(laser);
  return {
    jog: available(shared ?? review),
    frame: available(ordinaryJob ?? review),
    review: available(ordinaryJob ?? frame ?? review),
    start: available(ordinaryJob ?? frame),
    abort: available(abortIssue(laser, canControl)),
  };
}
function abortIssue(laser: Laser, canControl: boolean): string | null {
  if (!canControl) return 'Approve machine control on the computer first.';
  return laser.connection.kind !== 'connected' ? 'No machine is connected.' : null;
}
function available(reason: string | null) {
  return { available: reason === null, ...(reason === null ? {} : { reason }) };
}

export function machineOperationProjection(
  id: string,
  operation: OwnedMachineOperation | undefined,
  revision: string,
  options: RemoteControlOptions,
  page?: MachineReviewPageRequest,
): MachineOperation {
  if (
    page !== undefined &&
    (operation?.review?.id !== page.reviewId || operation.review.revision !== revision)
  )
    throw new RemoteFault('stale_revision');
  if (operation === undefined)
    return {
      operationId: id,
      kind: 'job',
      state: 'unknown',
      revision,
      committed: null,
      message:
        'This operation is unavailable in the current desktop session. Check the machine status before sending another action.',
    };
  const projectMessage = reviewMessageProjector(options);
  return {
    operationId: id,
    kind: operation.kind,
    state: operation.state,
    revision,
    committed: operation.committed,
    ...(operation.message === undefined
      ? {}
      : {
          message:
            operation.privateMessage === true && options.canShareArtwork?.() !== true
              ? 'Review this preparation problem in KerfDesk on the PC.'
              : projectMessage(operation.message, 'Check this operation in KerfDesk on the PC.'),
        }),
    ...(operation.review === undefined
      ? {}
      : { review: reviewProjection(operation.review, options, page) }),
  };
}
function reviewProjection(
  review: NonNullable<OwnedMachineOperation['review']>,
  options: RemoteControlOptions,
  page?: MachineReviewPageRequest,
): MachineReview {
  const artworkShared = options.canShareArtwork?.() === true;
  const projectMessage = artworkShared
    ? reviewMessageProjector(options)
    : (review.projectPrivateMessage ?? ((_value, fallback) => fallback));
  const model = review.model;
  return {
    reviewId: review.id,
    revision: review.revision,
    mode: model.machineKind,
    artworkShared,
    ...machineReviewPage(model, projectMessage, page),
    acknowledgement: model.acknowledgement,
    frame: { required: true, complete: framedRunReadinessIssue(currentCompletedFrame()) === null },
  };
}
