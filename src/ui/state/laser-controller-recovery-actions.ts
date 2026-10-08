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
import {
  hasCoordinatedControllerReset,
  abandonOwnedResetRecovery,
  ownedResetCleanupResult,
} from './laser-owned-reset-recovery';
import { frameProofReset } from './laser-session-reset';
import type { LaserState } from './laser-store';
import type { ControllerWakeOutcome } from './laser-store-action-types';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { clearCncLiveCaps } from './detected-settings-action';
import { pushLog } from './laser-store-helpers';
import {
  continueControllerOperation,
  controllerOperationOwner,
  controllerRecoveryResetEvidence,
  registerControllerRecoveryReset,
} from './laser-controller-operation';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type DriverFn = () => ControllerDriver;
type RecoveryRefs = ControllerLifecycleRefs & { readonly connection: unknown | null };
type RecoveryOwnership = {
  readonly owns: () => boolean;
  readonly assertOwned: () => void;
  readonly observedReset: () => boolean;
  readonly observedAlarm: () => boolean;
};

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
  if (hasCoordinatedControllerReset(get().controllerOperation)) {
    throw new Error(
      'The controller reset is already awaiting its startup response. Reconnect to replace the unresolved recovery.',
    );
  }
  const softReset = driver().realtime.softReset;
  if (softReset === null) throw new Error('This controller cannot be woken by soft reset.');
  // Read before the reset: the reboot banner ends the homing-state latch.
  const alarmNotice = wokeIntoAlarmNotice(
    get().resetRequired === 'homing-state',
    driver().commands.home,
  );
  clearCncLiveCaps();
  cancelControllerLifecycleRefs(refs, 'Controller recovery started.');
  let resetSent = false;
  const recovery = beginOwnedRecovery(set, get, refs, driver);
  try {
    await sendOwnedReset(safeWrite, softReset, recovery);
    recovery.assertOwned();
    resetSent = true;
    if (recovery.observedAlarm()) {
      await finishOwnedRecoveryCleanup(get, recovery);
      recovery.assertOwned();
      set(wokeIntoAlarmPatch(alarmNotice));
      return 'alarm';
    }
    set(afterResetPatch);
    await waitForFreshIdle(refs, { kind: 'recovery', requiredReports: 1 });
    await finishOwnedRecoveryCleanup(get, recovery);
    recovery.assertOwned();
    set((state) =>
      state.controllerOperation?.kind === 'recovery'
        ? {
            controllerOperation: null,
            lastWriteError: null,
            log: pushLog(state, '[lf2] Controller recovery confirmed after fresh Idle.'),
          }
        : {},
    );
    return 'idle';
  } catch (err) {
    // Reconnect, another Wake, or another operation may own the controller
    // now. An obsolete Promise must not clear or annotate that owner's state.
    if (!recovery.owns()) {
      if (resetSent) recovery.assertOwned();
      throw err;
    }
    if (resetSent && recovery.observedAlarm()) {
      await finishOwnedRecoveryCleanup(get, recovery);
      recovery.assertOwned();
      set(wokeIntoAlarmPatch(alarmNotice));
      return 'alarm';
    }
    publishOwnedRecoveryFailure(set, get, err);
    throw err;
  }
}

function publishOwnedRecoveryFailure(set: SetFn, get: GetFn, error: unknown): void {
  const operation = get().controllerOperation;
  if (operation === null) return;
  const owner = controllerOperationOwner(operation);
  const cleanupResolved = abandonOwnedResetRecovery(operation);
  const message = error instanceof Error ? error.message : String(error);
  set((state) => {
    if (
      state.controllerOperation === null ||
      controllerOperationOwner(state.controllerOperation) !== owner
    )
      return {};
    return {
      controllerOperation:
        !cleanupResolved && hasCoordinatedControllerReset(state.controllerOperation)
          ? state.controllerOperation
          : releaseRecoveryOperation(state),
      lastWriteError: message,
      log: pushLog(state, '[lf2] Controller recovery failed: ' + message),
    };
  });
}

async function finishOwnedRecoveryCleanup(get: GetFn, recovery: RecoveryOwnership): Promise<void> {
  const completion = ownedResetCleanupResult(get().controllerOperation);
  if (completion === null) return;
  const error = await completion;
  recovery.assertOwned();
  if (error !== null) throw error;
}

async function sendOwnedReset(
  safeWrite: SafeWriteFn,
  softReset: string,
  recovery: RecoveryOwnership,
): Promise<void> {
  recovery.assertOwned();
  try {
    await safeWrite(softReset, 'wake');
  } catch (error) {
    // A reboot banner or terminal Alarm may precede transport completion.
    // That evidence is stronger only while this exact recovery still owns it.
    if (!recovery.observedReset() && !recovery.observedAlarm()) throw error;
  }
  recovery.assertOwned();
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
    ...frameProofReset(),
    motionOperation: null,
    controllerOperation: continueControllerOperation(state.controllerOperation, {
      kind: 'recovery',
      phase: 'awaiting-idle',
      idleReports: 0,
    }),
    homingState: 'unknown',
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    lastWriteError: null,
    // The soft reset wiped the firmware's RX buffer — in-flight lines
    // will never be acked (audit F1).
    streamer: state.streamer === null ? null : wipeInFlight(cancelStreamer(state.streamer)),
    log: pushLog(state, '[lf2] Sent Ctrl-X soft reset. Waiting for fresh Idle.'),
  };
}

function wokeIntoAlarmPatch(notice: string): (state: LaserState) => Partial<LaserState> {
  return (state) => ({
    controllerOperation: releaseRecoveryOperation(state),
    lastWriteError: null,
    log: pushLog(state, notice),
  });
}

// A reset out of stock GRBL's homing state raises ALARM:6 and the controller
// comes back locked in Alarm
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L384).
// A single-axis Home, such as the Falcon command set's `$HX`, is what left it
// stuck and would again, so the note says Unlock for it (controller audit A-7,
// ADR-375 Amendment 1).
function wokeIntoAlarmNotice(fromHomingState: boolean, home: string | null): string {
  if (!fromHomingState) {
    return '[lf2] Controller reset and came back locked in Alarm, as it does after Sleep or a critical alarm. Unlock or Home it.';
  }
  const singleAxisHome = home
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => /^\$H[A-Z]/i.test(line));
  const stuck =
    '[lf2] Controller reset out of its homing state and came back locked in Alarm (ALARM:6).';
  return singleAxisHome === undefined
    ? `${stuck} Unlock or Home it.`
    : `${stuck} Unlock it: Home with this device profile sends ${singleAxisHome}, which leaves stock GRBL built without single-axis homing stuck again.`;
}

function releaseRecoveryOperation(state: LaserState): LaserState['controllerOperation'] {
  return state.controllerOperation?.kind === 'recovery' ? null : state.controllerOperation;
}

function controllerReportsAlarm(state: LaserState): boolean {
  return state.alarmCode !== null || state.statusReport?.state === 'Alarm';
}

function beginOwnedRecovery(
  set: SetFn,
  get: GetFn,
  refs: RecoveryRefs,
  driver: DriverFn,
): RecoveryOwnership {
  const connection = refs.connection;
  const connectionAttempt = get().connectionAttempt;
  const controller = driver();
  const writeEpoch = refs.writeEpoch ?? 0;
  const operation = { kind: 'recovery', phase: 'reset', idleReports: 0 } as const;
  set((state) => ({
    ...invalidateControllerSessionEvidence(state),
    controllerOperation: operation,
  }));
  const initialEvidence = {
    sessionEpoch: get().controllerSessionEpoch,
    writeEpoch,
    statusSequence: get().statusSequence,
  };
  const resetEvidence = () => controllerRecoveryResetEvidence(operation) ?? initialEvidence;
  const observedReset = () => get().controllerSessionEpoch === resetEvidence().sessionEpoch + 1;
  const observedAlarm = () => {
    const state = get();
    const evidence = resetEvidence();
    const expectedWriteEpoch = evidence.writeEpoch + (observedReset() ? 1 : 0);
    const currentWriteEpoch = refs.writeEpoch ?? 0;
    // A numbered Alarm advances the write epoch. A pure status Alarm is
    // equally terminal, even when repeating an Alarm that preceded Wake.
    // Neither can pardon an unrelated write/session epoch change.
    return (
      controllerReportsAlarm(state) &&
      (currentWriteEpoch === expectedWriteEpoch + 1 ||
        (currentWriteEpoch === expectedWriteEpoch &&
          state.statusSequence > evidence.statusSequence))
    );
  };
  const owns = () => {
    const state = get();
    const evidence = resetEvidence();
    return (
      state.connection.kind === 'connected' &&
      refs.connection === connection &&
      state.connectionAttempt === connectionAttempt &&
      driver() === controller &&
      state.controllerOperation !== null &&
      controllerOperationOwner(state.controllerOperation) === operation &&
      (state.controllerSessionEpoch === evidence.sessionEpoch || observedReset()) &&
      ((refs.writeEpoch ?? 0) === evidence.writeEpoch + (observedReset() ? 1 : 0) ||
        observedAlarm())
    );
  };
  registerControllerRecoveryReset(operation, initialEvidence, owns);
  return {
    owns,
    observedReset: () => owns() && observedReset(),
    observedAlarm: () => owns() && observedAlarm(),
    assertOwned: () => {
      if (!owns())
        throw new Error('Controller recovery was superseded by another session or operation.');
    },
  };
}
