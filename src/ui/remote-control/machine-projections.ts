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
import type { MachineOperation, MachineReview } from './machine-types';

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
    },
    frame: {
      required: true,
      complete: framedRunReadinessIssue(currentCompletedFrame(laser), app, laser) === null,
    },
    job: jobProjection(laser),
    motion: { kind: motionKind(laser) },
    availability: availabilityProjection(app, laser, canControl),
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
): MachineOperation {
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
      : { review: reviewProjection(operation.review, options) }),
  };
}
function reviewProjection(
  review: NonNullable<OwnedMachineOperation['review']>,
  options: RemoteControlOptions,
): MachineReview {
  const projectMessage =
    options.canShareArtwork?.() === true
      ? reviewMessageProjector(options)
      : (review.projectPrivateMessage ?? ((_value, fallback) => fallback));
  const model = review.model;
  return {
    reviewId: review.id,
    revision: review.revision,
    mode: model.machineKind,
    stats: model.stats.slice(0, 16).map((stat) => ({
      label: projectMessage(stat.label, 'Job fact'),
      value: projectMessage(stat.value, 'See PC'),
      detail: projectMessage(stat.detail, 'Review this fact on the PC.'),
      ...(stat.emphasis === undefined ? {} : { emphasis: stat.emphasis }),
    })),
    warnings: model.warnings.slice(0, 200).map((message, index) => ({
      code: `review-${index + 1}`,
      message: projectMessage(message, 'Review this artwork-specific warning on the PC.'),
    })),
    operations: model.effectiveOperations.slice(0, 200).map((item) => ({
      operationId: item.layerId,
      summaries: item.summaries
        .slice(0, 20)
        .map((summary) => projectMessage(summary, 'Review this operation summary on the PC.')),
    })),
    acknowledgement: model.acknowledgement,
    frame: { required: true, complete: framedRunReadinessIssue(currentCompletedFrame()) === null },
  };
}
