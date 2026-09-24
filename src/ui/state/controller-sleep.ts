// Whether Release motors (`$SLP`) can work on the connected controller, and why
// not (controller audit drivers-4). grblHAL answers `$SLP` with error:3 unless
// its `$62` Sleep enable setting is on, and `$62` defaults to off (grblHAL
// core, enter_sleep and setting_SleepEnable). The control used to send it
// anyway: the refusal voided the work origin and raised a controller-error
// notice while the motors stayed energized. When a `$$` read reported
// `$62=0` the control is disabled with that fact instead. A build whose `$$`
// was never read or does not list `$62`, such as the Falcon's, keeps the
// control, and releaseMotors reports a refusal without touching the origin.

import type { LaserState } from './laser-store';

export const NO_SLEEP_COMMAND_MESSAGE = 'Controller has no sleep command.';

export const GRBLHAL_SLEEP_DISABLED_MESSAGE =
  'Sleep ($SLP) is disabled in this grblHAL build ($62=0). Set $62=1 in the controller settings to release the motors from KerfDesk.';

const GRBLHAL_SLEEP_ENABLE_SETTING = 62;

export function sleepUnavailableReason(
  state: Pick<LaserState, 'capabilities' | 'activeControllerKind' | 'grblSettingsRows'>,
): string | null {
  if (!state.capabilities.sleep) return NO_SLEEP_COMMAND_MESSAGE;
  if (state.activeControllerKind !== 'grblhal') return null;
  const sleepEnable = state.grblSettingsRows.find((row) => row.id === GRBLHAL_SLEEP_ENABLE_SETTING);
  return sleepEnable?.numericValue === 0 ? GRBLHAL_SLEEP_DISABLED_MESSAGE : null;
}

/** The message for a `$SLP` the controller refused before running it. */
export function sleepRefusalMessage(
  activeControllerKind: LaserState['activeControllerKind'],
  refusal: string,
): string {
  if (activeControllerKind === 'grblhal' && /\berror:3\b/i.test(refusal)) {
    return GRBLHAL_SLEEP_DISABLED_MESSAGE;
  }
  return `The controller refused $SLP (${refusal}). The motors are still energized and the origin is unchanged.`;
}
