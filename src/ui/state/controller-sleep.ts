// Whether Release motors (`$SLP`) can work on the connected controller, and why
// not (controller audit drivers-4). grblHAL answers `$SLP` with error:3 unless
// its `$62` Sleep enable setting is on, and `$62` defaults to off (grblHAL
// core, enter_sleep and setting_SleepEnable). The control used to send it
// anyway: the refusal voided the work origin and raised a controller-error
// notice while the motors stayed energized. When a `$$` read reported
// `$62=0` the control is disabled with that fact instead. A build whose `$$`
// was never read or does not list `$62`, such as the Falcon's, keeps the
// control, and releaseMotors reports a refusal without touching the origin.
//
// The advice names `$62=1` only where KerfDesk can write it (a driver with
// `$N=` settings writes), and states `$62=0` only when `$$` reported it. The
// Falcon contract cannot write `$62`, never reads `$$`, and a vendor build may
// not have `$62` at all: grblHAL registers it only when SLEEP_DURATION > 0
// (settings.c:2141-2143), and answers `$SLP` with error:3 whenever sleep is
// disabled (system.c:572-576), so the refusal proves neither (audit HF-4).

import type { LaserState } from './laser-store';

export const NO_SLEEP_COMMAND_MESSAGE = 'Controller has no sleep command.';

const SLEEP_REPORTED_OFF = 'Sleep ($SLP) is disabled in this grblHAL build ($62=0).';
const MOTORS_STILL_ENERGIZED = 'The motors are still energized and the origin is unchanged.';

export const GRBLHAL_SLEEP_DISABLED_MESSAGE = `${SLEEP_REPORTED_OFF} Set $62=1 in the controller settings to release the motors from KerfDesk.`;

const GRBLHAL_SLEEP_ENABLE_SETTING = 62;

type SleepEvidence = Pick<LaserState, 'capabilities' | 'activeControllerKind' | 'grblSettingsRows'>;

export function sleepUnavailableReason(state: SleepEvidence): string | null {
  if (!state.capabilities.sleep) return NO_SLEEP_COMMAND_MESSAGE;
  if (state.activeControllerKind !== 'grblhal' || !sleepSettingReportedOff(state)) return null;
  return canWriteSleepSetting(state)
    ? GRBLHAL_SLEEP_DISABLED_MESSAGE
    : `${SLEEP_REPORTED_OFF} KerfDesk cannot change $62 with this controller profile.`;
}

/** The message for a `$SLP` the controller refused before running it. */
export function sleepRefusalMessage(state: SleepEvidence, refusal: string): string {
  if (state.activeControllerKind !== 'grblhal' || !/\berror:3\b/i.test(refusal)) {
    return `The controller refused $SLP (${refusal}). ${MOTORS_STILL_ENERGIZED}`;
  }
  const canWrite = canWriteSleepSetting(state);
  if (sleepSettingReportedOff(state)) {
    return canWrite
      ? GRBLHAL_SLEEP_DISABLED_MESSAGE
      : `${SLEEP_REPORTED_OFF} ${MOTORS_STILL_ENERGIZED}`;
  }
  const refused = `The controller refused $SLP (${refusal}): sleep is disabled or not supported in this firmware build. ${MOTORS_STILL_ENERGIZED}`;
  return canWrite
    ? `${refused} If the controller settings list $62 (Sleep enable), set $62=1 to release the motors from KerfDesk.`
    : refused;
}

function sleepSettingReportedOff(state: SleepEvidence): boolean {
  const sleepEnable = state.grblSettingsRows.find((row) => row.id === GRBLHAL_SLEEP_ENABLE_SETTING);
  return sleepEnable?.numericValue === 0;
}

function canWriteSleepSetting(state: SleepEvidence): boolean {
  return state.capabilities.settings === 'grbl-dollar';
}
