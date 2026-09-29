// laser-console-completion — what a Console command leaves behind once the
// controller has acknowledged it (controller audit 2026-09-23).
//
// The rail's own buttons for these commands (Machine Settings read, the Alarm
// banner's Unlock, the settings dialog) each finish their exchange; the same
// commands typed in the Console did not, so they left state behind that only a
// reset or reconnect cleared:
// - `$$` answered by a bare `ok` kept the settings marker forever, which
//   stopped status polling and refused Jog, Frame and Start (settings-console-2);
// - `$X` left the alarm latched, so Start and Fire refused on an Idle
//   controller (cnc-controller-1);
// - `$13=` hid machine position until `$$` happened to be sent (regressions-1).

import { idleCollector, type SettingsCollectorState } from '../../core/controllers/grbl';
import * as detectedSettings from './detected-settings-action';
import { interactiveControllerOperation } from './laser-controller-operation';
import { retainControllerReportUnits } from './controller-report-units';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { isProbeFailureAlarm } from './probe-failure-alarm';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SettingsReadRefs = {
  settingsCollector: SettingsCollectorState;
  settingsCollectorSessionEpoch: number | null;
};

export const EMPTY_SETTINGS_RESPONSE_MESSAGE =
  'The controller settings response was empty. Retry reading controller settings.';

export function beginConsoleSettingsRead(set: SetFn, get: GetFn, refs: SettingsReadRefs): void {
  detectedSettings.beginSettingsCollection(refs, get().controllerSessionEpoch);
  set({
    controllerOperation: interactiveControllerOperation(
      detectedSettings.SETTINGS_READ_OPERATION_LABEL,
      'terminal-exchange',
    ),
    detectedSettings: null,
    controllerSettings: retainControllerReportUnits(get().controllerSettings),
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
}

/** After the console `$$` was acknowledged. A dump with settings has already
 *  been published and its marker released by the line handler; a bare `ok`
 *  leaves the collector collecting, which is the empty response. */
export function finishConsoleSettingsRead(set: SetFn, get: GetFn, refs: SettingsReadRefs): void {
  if (refs.settingsCollector.kind !== 'collecting') return;
  if (refs.settingsCollectorSessionEpoch !== get().controllerSessionEpoch) return;
  releaseConsoleSettingsRead(set, get, refs);
  set((state) => ({ log: pushLog(state, `[lf2] ${EMPTY_SETTINGS_RESPONSE_MESSAGE}`) }));
}

export function releaseConsoleSettingsRead(set: SetFn, get: GetFn, refs: SettingsReadRefs): void {
  const sessionEpoch = get().controllerSessionEpoch;
  if (refs.settingsCollectorSessionEpoch === sessionEpoch) {
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
  }
  set((state) =>
    isSettingsReadOperation(state.controllerOperation) ? { controllerOperation: null } : {},
  );
}

export function isSettingsReadOperation(operation: LaserState['controllerOperation']): boolean {
  return (
    operation?.kind === 'interactive-command' &&
    operation.label === detectedSettings.SETTINGS_READ_OPERATION_LABEL
  );
}

/** The controller acknowledged `$X`: the same state the Alarm banner's Unlock
 *  leaves. Positions and references taken before the alarm no longer hold,
 *  except after a failed probe: `unlockedAlarm`, the alarm this Unlock cleared,
 *  read before its reply, is ALARM:4 or 5, which stopped only the probe move,
 *  so the machine position and the XY origin still stand and the next reports
 *  carry them (probe-failure-alarm.ts). Work Z is void either way. The alarm
 *  code stays until a report that is not Alarm clears it: FluidNC acknowledges
 *  `$X` in its Critical state without unlocking, and its next report still
 *  reads Alarm (controller audit 2026-09-25 HF-2). */
export function controllerUnlockedPatch(
  state: LaserState,
  unlockedAlarm: number | null,
): Partial<LaserState> {
  const probeFailed = isProbeFailureAlarm(unlockedAlarm);
  return {
    homingState: 'unknown',
    homingProof: null,
    ...(probeFailed ? {} : positionLostAtUnlockPatch(state)),
    statusReport: null,
    statusObservation: null,
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    log: pushLog(
      state,
      probeFailed
        ? '[lf2] Controller unlocked after a failed probe. Kept position and XY origin evidence; cleared Z, Home, and Frame evidence.'
        : '[lf2] Controller unlocked. Cleared stale position, origin, Z, Home, and Frame evidence.',
    ),
  };
}

function positionLostAtUnlockPatch(state: LaserState): Partial<LaserState> {
  const persistentOrUnknown =
    state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown';
  return {
    positionEvidenceSuppressed: true,
    wcoCache: null,
    workOriginActive: persistentOrUnknown,
    workOriginSource: persistentOrUnknown ? 'unknown' : 'none',
  };
}

/** The `$$` re-read after a console `$13=` write failed: position stays hidden
 *  (the units really are unknown), and the log says how to restore it. */
export function reportUnitsStayUnconfirmed(set: SetFn, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  set((state) => ({
    log: pushLog(
      state,
      `[lf2] Report units are unconfirmed after the $13 write (${reason}). Read controller settings ($$) to show machine position again.`,
    ),
  }));
}

/** The `$$` re-read after another console setting write failed. The write was
 *  acknowledged, so only the read-back is missing (ADR-375, C-4). */
export function settingWriteStaysUnverified(set: SetFn, written: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  set((state) => ({
    log: pushLog(
      state,
      `[lf2] The controller acknowledged ${written}, but reading its settings back failed (${reason}). Read controller settings ($$) to see the stored value.`,
    ),
  }));
}
