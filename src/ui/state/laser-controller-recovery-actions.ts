// Controller recovery actions that are not normal motion/job commands.
// Sleep wake uses GRBL soft reset (Ctrl-X), so it must invalidate any transient
// origin/frame state just like Stop does.
//
// After a reset from Sleep (and after a critical alarm) GRBL, grblHAL and
// FluidNC come back locked in Alarm by design (gnea/grbl protocol.c:49-54,
// grblHAL protocol.c:167-173, FluidNC Protocol.cpp:1158-1159), so an Alarm
// report or an ALARM line after the reset completes the wake: it resolves
// 'alarm' and the Alarm banner offers Unlock or Home (controller audit
// 2026-09-25 HF-5, CG-8).

import { cancel as cancelStreamer, wipeInFlight } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import {
  cancelControllerLifecycleRefs,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import type { ControllerWakeOutcome } from './laser-store-action-types';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { clearCncLiveCaps } from './detected-settings-action';
import { pushLog } from './laser-store-helpers';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type DriverFn = () => ControllerDriver;
type RecoveryRefs = ControllerLifecycleRefs & { readonly connection: unknown | null };

export function controllerRecoveryActions(
  set: SetFn,
  get: GetFn,
  refs: RecoveryRefs,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Pick<LaserState, 'wakeController'> {
  return { wakeController: () => runWake(set, get, refs, safeWrite, driver) };
}

async function runWake(
  set: SetFn,
  get: GetFn,
  refs: RecoveryRefs,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Promise<ControllerWakeOutcome> {
  // Soft reset is a live-transport operation, not a reconnect mechanism.
  // Guard before invalidating evidence or claiming the global recovery
  // operation so USB loss cannot deadlock the remaining controls.
  if (get().connection.kind !== 'connected' || refs.connection === null) {
    const message =
      'Controller is not connected. Reconnect the controller before sending a soft reset.';
    set((state) => ({
      lastWriteError: message,
      log: pushLog(state, `[lf2] Controller recovery blocked: ${message}`),
    }));
    throw new Error(message);
  }
  const softReset = driver().realtime.softReset;
  if (softReset === null) throw new Error('This controller cannot be woken by soft reset.');
  clearCncLiveCaps();
  cancelControllerLifecycleRefs(refs, 'Controller recovery started.');
  const resetWriteEpoch = refs.writeEpoch ?? 0;
  let resetSent = false;
  set((state) => ({
    ...invalidateControllerSessionEvidence(state),
    controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 },
  }));
  try {
    try {
      await safeWrite(softReset, 'wake');
    } catch (error) {
      // Web Serial may deliver the commanded reboot banner before its
      // write Promise resolves. That observed boundary is stronger than
      // the old transport Promise, provided recovery still owns it.
      if (!observedOwnedRecoveryReset(get, refs, resetWriteEpoch)) throw error;
    }
    resetSent = true;
    set(afterResetPatch);
    await waitForFreshIdle(refs, { kind: 'recovery', requiredReports: 1 });
    set((state) =>
      state.controllerOperation?.kind === 'recovery'
        ? {
            controllerOperation: null,
            log: pushLog(state, '[lf2] Controller recovery confirmed after fresh Idle.'),
          }
        : {},
    );
    return 'idle';
  } catch (err) {
    if (resetSent && controllerReportsAlarm(get())) {
      set(wokeIntoAlarmPatch);
      return 'alarm';
    }
    const message = err instanceof Error ? err.message : String(err);
    set((state) => ({
      controllerOperation: releaseRecoveryOperation(state),
      lastWriteError: message,
      log: pushLog(state, `[lf2] Controller recovery failed: ${message}`),
    }));
    throw err;
  }
}

function afterResetPatch(state: LaserState): Partial<LaserState> {
  const originSurvives =
    state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown';
  return {
    statusReport: null,
    alarmCode: null,
    lastError: null,
    wcoCache: null,
    accessoryCache: null,
    workOriginActive: originSurvives,
    workOriginSource: originSurvives ? 'unknown' : 'none',
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    motionOperation: null,
    controllerOperation: { kind: 'recovery', phase: 'awaiting-idle', idleReports: 0 },
    homingState: 'unknown',
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    lastWriteError: null,
    // The soft reset wiped the firmware's RX buffer — in-flight lines
    // will never be acked (audit F1).
    streamer: state.streamer === null ? null : wipeInFlight(cancelStreamer(state.streamer)),
    log: pushLog(state, '[lf2] Sent Ctrl-X soft reset. Waiting for fresh Idle.'),
  };
}

function wokeIntoAlarmPatch(state: LaserState): Partial<LaserState> {
  return {
    controllerOperation: releaseRecoveryOperation(state),
    lastWriteError: null,
    log: pushLog(
      state,
      '[lf2] Controller reset and came back locked in Alarm, as it does after Sleep or a critical alarm. Unlock or Home it.',
    ),
  };
}

function releaseRecoveryOperation(state: LaserState): LaserState['controllerOperation'] {
  return state.controllerOperation?.kind === 'recovery' ? null : state.controllerOperation;
}

function controllerReportsAlarm(state: LaserState): boolean {
  return state.alarmCode !== null || state.statusReport?.state === 'Alarm';
}

function observedOwnedRecoveryReset(
  get: GetFn,
  refs: ControllerLifecycleRefs,
  previousWriteEpoch: number,
): boolean {
  const state = get();
  return (
    (refs.writeEpoch ?? 0) > previousWriteEpoch &&
    state.connection.kind === 'connected' &&
    state.controllerOperation?.kind === 'recovery'
  );
}
