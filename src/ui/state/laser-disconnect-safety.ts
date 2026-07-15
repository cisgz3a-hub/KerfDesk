import type { ControllerDriver } from '../../core/controllers';
import { disconnectStopUnconfirmedNotice, type LaserSafetyNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

type WriteFailedAction = Extract<LaserSafetyNotice, { readonly kind: 'write-failed' }>['action'];

const PHYSICAL_STOP_UNCERTAIN_WRITE_ACTIONS: ReadonlySet<WriteFailedAction> = new Set([
  'start',
  'pause',
  'resume',
  'stop',
  'disconnect',
  'frame',
  'jog',
  'home',
  'probe',
  'air-assist',
  'fire',
  'console',
  'stream',
]);

export function unconfirmedDisconnectStopNotice(
  state: LaserState,
  driver: ControllerDriver,
): LaserSafetyNotice | null {
  if (driver.realtime.softReset !== null || !disconnectNeedsPhysicalStop(state)) return null;
  return disconnectStopUnconfirmedNotice();
}

export function retainedDisconnectSafetyNotice(state: LaserState): LaserSafetyNotice | null {
  const notice = state.safetyNotice;
  if (notice?.kind === 'disconnect-stop-unconfirmed') return notice;
  return notice?.kind === 'write-failed' && notice.action === 'disconnect' ? notice : null;
}

/** Keep the physical-stop warning when the transport is already gone and
 * Forget therefore has no channel on which to prove that buffered motion or
 * Fire output stopped. Other stale notices are intentionally cleared by the
 * clean controller reset. */
export function retainedUnavailableTransportSafetyNotice(
  state: LaserState,
): LaserSafetyNotice | null {
  const retained = retainedDisconnectSafetyNotice(state);
  if (retained !== null) return retained;
  const notice = state.safetyNotice;
  if (notice !== null && safetyNoticeLeavesPhysicalStopUncertain(notice)) {
    return notice;
  }
  return null;
}

export function safetyNoticeLeavesPhysicalStopUncertain(notice: LaserSafetyNotice): boolean {
  if (
    notice.kind === 'disconnect-during-job' ||
    notice.kind === 'disconnect-during-fire' ||
    notice.kind === 'disconnect-stop-unconfirmed'
  ) {
    return true;
  }
  return notice.kind === 'write-failed' && PHYSICAL_STOP_UNCERTAIN_WRITE_ACTIONS.has(notice.action);
}

export function withRetainedDisconnectSafety(
  patch: Partial<LaserState>,
  notice: LaserSafetyNotice | null,
): Partial<LaserState> {
  if (notice === null) return patch;
  return { ...patch, safetyNotice: notice };
}

function disconnectNeedsPhysicalStop(state: LaserState): boolean {
  return (
    isActiveJob(state.streamer) ||
    state.fireActive ||
    state.motionOperation !== null ||
    (state.controllerOperation !== null &&
      state.controllerOperation.kind !== 'connection-handshake') ||
    (state.safetyNotice !== null && safetyNoticeLeavesPhysicalStopUncertain(state.safetyNotice))
  );
}
