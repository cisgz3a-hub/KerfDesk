// Where the momentary low-power Fire button may exist, and the exact S word a
// press sends (ADR-162 as amended by ADR-387). The machine's own "Enable Fire
// button" opt-in is the operator's consent, as LightBurn's per-device "Enable
// Laser Fire Button" setting is; this module only decides which profiles may
// carry that opt-in at all. The caps themselves live in fire-control.ts.

import {
  deviceSupportsMachineKind,
  type DeviceProfile,
  type LaserTechnology,
} from './device-profile';
import {
  cappedFirePowerS,
  HARD_MAX_FIRE_POWER_PERCENT,
  type LaserFireControl,
} from './fire-control';

/** The facts of a profile's controller driver that decide whether it can drive Fire. */
export type FireControllerSupport = {
  readonly label: string;
  readonly lowPowerFire: boolean;
};

/**
 * Why this profile cannot offer the Fire button at all, or null when the
 * operator may opt in. The opt-in (`fireControl.enabled`) is not read here.
 */
export function fireOfferIssue(
  profile: DeviceProfile,
  controller: FireControllerSupport,
): string | null {
  if (!deviceSupportsMachineKind(profile, 'laser')) {
    return 'This machine profile has no laser output, so it has no Fire button.';
  }
  if (!controller.lowPowerFire) {
    return `${controller.label} controllers have no Fire button in KerfDesk; Fire needs a GRBL-family controller.`;
  }
  return invisibleBeamIssue(profile.laserSubProfile?.technology);
}

// LightBurn documents its Fire button as diode-only: it "should never be used
// for a CO2 laser, which has an invisible beam that could blind you or start a
// fire". It only warns; a profile that declares an invisible beam gets no
// button here. Unknown or undeclared technology keeps the opt-in and its
// diode-only caution.
// https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/BasicSettings/
function invisibleBeamIssue(technology: LaserTechnology | undefined): string | null {
  if (technology !== 'co2' && technology !== 'fiber') return null;
  const source = technology === 'co2' ? 'CO2' : 'fiber';
  return `Fire is only for visible-beam diode lasers. This profile's ${source} laser has an invisible beam that can blind or start a fire before anyone sees it.`;
}

/** The Fire settings a press may use, or null while Fire is off or not offered. */
export function enabledFireControl(
  profile: DeviceProfile,
  controller: FireControllerSupport,
): LaserFireControl | null {
  if (fireOfferIssue(profile, controller) !== null) return null;
  const control = profile.fireControl;
  return control?.enabled === true ? control : null;
}

/** The percent a press requests, never above the absolute ceiling. */
export function fireButtonPercent(control: LaserFireControl): number {
  return Math.min(Math.max(0, control.maxPowerPercent), HARD_MAX_FIRE_POWER_PERCENT);
}

/** "1", "1.5", "0.25": the percent as operators type it, without float noise. */
export function formatFirePercent(percent: number): string {
  return String(Number(percent.toFixed(2)));
}

/** The S word a press sends: the same capped value the Fire action writes. */
export function fireButtonPowerS(control: LaserFireControl, maxPowerS: number): number {
  return cappedFirePowerS(control.maxPowerPercent, control, maxPowerS);
}

/**
 * Why these settings cannot light the beam on this S scale, or null. A small
 * percent of a small $30 rounds to S0, which the Fire action refuses; saying
 * so before the press beats a refusal after it.
 */
export function firePowerIssue(control: LaserFireControl, maxPowerS: number): string | null {
  if (fireButtonPowerS(control, maxPowerS) > 0) return null;
  return `Fire power ${formatFirePercent(fireButtonPercent(control))}% rounds to S0 on this machine's S${maxPowerS} scale, which cannot light the beam.`;
}
