import type { ControllerDriver } from '../../core/controllers';
import { driverQuickStops, noResetStopLines } from './laser-quick-stop';
import {
  disconnectStopUnconfirmedNotice,
  isControllerHaltedNotice,
  quickStopUnconfirmedNotice,
  type LaserSafetyNotice,
} from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { disconnectStopCommands, isActiveJob } from './laser-store-helpers';

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

/** The lines Disconnect or Forget writes before closing the port of a
 * controller outside the GRBL family, and whether they quick-stop it. A
 * controller that stops with quickstop lines (Marlin) gets them whenever a
 * job, a motion, a controller operation or a lit beam may still be running, as
 * ABORT MOTION sends them (MA-7). Otherwise, with nothing else to send, a
 * notice that leaves the physical stop uncertain still gets the driver's stop. */
export function disconnectStopPlan(
  state: LaserState,
  driver: ControllerDriver,
): { readonly commands: ReadonlyArray<string>; readonly quickStopped: boolean } {
  const softReset = driver.realtime.softReset;
  if (softReset === null && driverQuickStops(driver) && disconnectNeedsPhysicalStop(state)) {
    const fireOff = state.fireActive ? ['M5\n'] : [];
    return { commands: [...fireOff, ...noResetStopLines(driver, state)], quickStopped: true };
  }
  const ordinary = disconnectStopCommands(state, driver);
  const uncertain =
    ordinary.length === 0 &&
    state.safetyNotice !== null &&
    safetyNoticeLeavesPhysicalStopUncertain(state.safetyNotice);
  const commands = !uncertain
    ? ordinary
    : softReset === null
      ? noResetStopLines(driver, state)
      : [softReset, ...driver.commands.stopLaserLines.map((line) => `${line}\n`)];
  return { commands, quickStopped: false };
}

export function unconfirmedDisconnectStopNotice(
  state: LaserState,
  driver: ControllerDriver,
): LaserSafetyNotice | null {
  if (driver.realtime.softReset !== null || !disconnectNeedsPhysicalStop(state)) return null;
  // A halted controller (Marlin kill()) ran none of the stop lines; it still
  // needs its reset button or a power cycle (MA-10).
  if (isControllerHaltedNotice(state.safetyNotice)) return state.safetyNotice;
  return disconnectStopPlan(state, driver).quickStopped
    ? quickStopUnconfirmedNotice()
    : disconnectStopUnconfirmedNotice();
}

export function safetyNoticeBeforeDisconnect(
  state: LaserState,
  driver: ControllerDriver,
): LaserSafetyNotice | null {
  return (
    unconfirmedDisconnectStopNotice(state, driver) ??
    retainedUnavailableTransportSafetyNotice(state)
  );
}

export function retainedDisconnectSafetyNotice(
  state: Pick<LaserState, 'safetyNotice'>,
): LaserSafetyNotice | null {
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

export function acknowledgeSafetyNotice(
  notice: LaserSafetyNotice | null,
  refs: { safetyNoticeAcknowledgementRevision?: number },
): { safetyNotice: null } {
  if (notice !== null) {
    refs.safetyNoticeAcknowledgementRevision = (refs.safetyNoticeAcknowledgementRevision ?? 0) + 1;
  }
  return { safetyNotice: null };
}
/** A delayed teardown may retain an incident until the operator acknowledges
 * it. After that acknowledgement, only the current/new incident may survive. */
export function disconnectSafetyNoticeReader(
  get: () => LaserState,
  refs: { readonly safetyNoticeAcknowledgementRevision?: number },
  snapshot: () => LaserSafetyNotice | null,
): () => LaserSafetyNotice | null {
  const revision = refs.safetyNoticeAcknowledgementRevision ?? 0;
  return () =>
    (refs.safetyNoticeAcknowledgementRevision ?? 0) === revision ? snapshot() : get().safetyNotice;
}
/** Forget clears stale incidents after successful live cleanup, while retaining
 * unconfirmed stops and any failure newly raised by that disconnect. */
export function retainedLiveForgetSafetyNotice(
  notice: LaserSafetyNotice | null,
  precedingNotice: LaserSafetyNotice | null,
  disconnectFailed: boolean,
): LaserSafetyNotice | null {
  return notice === precedingNotice && !disconnectFailed && !isControllerHaltedNotice(notice)
    ? retainedDisconnectSafetyNotice({ safetyNotice: notice })
    : notice;
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
