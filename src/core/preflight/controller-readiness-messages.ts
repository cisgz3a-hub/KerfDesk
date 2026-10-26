// Readiness advice for the controller settings `$30` (S / RPM scale) and `$32`
// (laser mode), worded for where the setting lives (controller audit OR-6).
//
// GRBL and grblHAL store them as writable `$N=` settings. FluidNC does not:
// its `$32` and `$30` are read-only proxies of the YAML spindle configuration
// (FluidNC v4.0.3 SettingsDefinitions.cpp:146 `INT_PROXY("32", "Grbl/LaserMode",
// spindle->isRateAdjusted())`, :148 `INT_PROXY("30", "Grbl/MaxSpindleSpeed",
// spindle->maxSpeed())`; Settings.h:229 answers a write with ReadOnlySetting).
// `$32` is 1 only for a `Laser` spindle, `$30` is the top of the spindle's
// `speed_map` (Spindle.cpp:150-156, Spindle.h:106), and M4 is refused by a
// spindle that is neither a Laser nor reversible (GCode.cpp:654-658).

/** Where the controller keeps `$30`/`$32`: writable `$N=` settings, or
 *  FluidNC's YAML spindle configuration (the only read-only dump). */
export type ReadinessSettingsSource = 'dollar-settings' | 'fluidnc-yaml';

export function readinessSettingsSource(
  capability: 'grbl-dollar' | 'readonly-dump' | 'none',
): ReadinessSettingsSource {
  return capability === 'readonly-dump' ? 'fluidnc-yaml' : 'dollar-settings';
}

export function laserModeDisabledMessage(source: ReadinessSettingsSource): string {
  return source === 'fluidnc-yaml'
    ? "Controller reports $32=0: its spindle is not a Laser spindle. FluidNC's $32 follows the spindle type and cannot be set with $32=1, so configure the spindle as Laser in the FluidNC YAML config, or choose the GRBL Compatible (constant-power) output dialect in Machine Setup: dynamic power (M4) needs a Laser spindle."
    : 'Controller reports $32=0. Enable GRBL laser mode ($32=1) before starting from KerfDesk.';
}

export function laserModeUnverifiedMessage(source: ReadinessSettingsSource): string {
  return source === 'fluidnc-yaml'
    ? 'Controller settings did not confirm $32, so laser mode is NOT verified against the firmware. Confirm the spindle is configured as Laser in the FluidNC YAML config before burning.'
    : 'Controller settings did not confirm $32, so laser mode is NOT verified against the firmware. Confirm $32=1 in the controller configuration before burning.';
}

/** The laser `max-power-mismatch` message. Like every readiness error, Start
 *  shows it as a Job Review warning (start-job-controller-policy.ts) and Save
 *  states it as an advisory; it refuses nothing on its own. */
export function laserMaxPowerMismatchMessage(
  controllerMaxPowerS: number,
  projectMaxPowerS: number,
  source: ReadinessSettingsSource,
): string {
  const mismatch = `Controller $30 is ${controllerMaxPowerS} but this project is set to max S ${projectMaxPowerS}.`;
  return source === 'fluidnc-yaml'
    ? `${mismatch} FluidNC reports $30 from the top of the spindle's speed_map in its YAML config, so it cannot be set with $30=: apply the detected setting to the profile before starting, or change speed_map in the YAML config.`
    : `${mismatch} Apply the detected setting before starting.`;
}

/** Which firmware's behaviour the `power-range-empty` warning describes. */
export type PowerRangeFirmware = 'grbl' | 'grblhal' | 'fluidnc' | 'unknown';

const LASER_OFF_MOVES_AT_FULL_POWER =
  'so laser-off moves fire the beam at full power while M3 or M4 is on';
const GRBLHAL_ON_OFF_CONTROL =
  'switches to on/off spindle control, so S no longer sets laser power';
const RAISE_MAX_S = 'Set $30 above $31 before burning.';

/** `$30` at or below `$31` leaves no S range, and firmwares differ on what
 *  follows. Stock GRBL's `spindle_compute_pwm_value` returns the maximum PWM
 *  when `rpm_min >= rpm_max`, before its S0 branch:
 *  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c#L192-L205
 *  grblHAL's `spindle_precompute_pwm_values` instead marks the spindle not
 *  variable when `rpm_max <= rpm_min`, and the driver reverts to on/off control:
 *  https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/spindle_control.c#L1045-L1078
 *  FluidNC reports only `$30`, the top of its spindle speed_map. A Job Review
 *  warning, never a Start guard (ADR-565, ADR-567 Amendment 1). */
export function laserPowerRangeEmptyMessage(
  maxS: number,
  minS: number | undefined,
  firmware: PowerRangeFirmware,
): string {
  const range =
    minS === undefined
      ? `Controller reports $30=${maxS}, so there is no S power range.`
      : `Controller $30=${maxS} is not above $31=${minS}, so there is no S power range.`;
  switch (firmware) {
    case 'grbl':
      return `${range} The controller fires full power even at S0, ${LASER_OFF_MOVES_AT_FULL_POWER} (stock GRBL). ${RAISE_MAX_S}`;
    case 'grblhal':
      return `${range} grblHAL then ${GRBLHAL_ON_OFF_CONTROL}. ${RAISE_MAX_S}`;
    case 'fluidnc':
      return `${range} FluidNC reports $30 from the top of the spindle's speed_map in its YAML config, so check speed_map before burning.`;
    case 'unknown':
      return `${range} Stock GRBL then fires full power even at S0, ${LASER_OFF_MOVES_AT_FULL_POWER}; grblHAL instead ${GRBLHAL_ON_OFF_CONTROL}. ${RAISE_MAX_S}`;
  }
}

/** `$31` above zero with `$30` above it (controller audit v4 E1-P3-2). Stock
 *  GRBL's `spindle_compute_pwm_value` maps S linearly from `$31` up to `$30`
 *  and gives any S > 0 at or below `$31` the lowest PWM step (1 of 255), so
 *  every power below 100% burns weaker than set: at `$31=100`, `$30=1000`, 60%
 *  runs at 55.7%. grblHAL maps the same way with its `$35` PWM minimum as the
 *  floor (0.4% of full when `$35=0`); a raised `$35` lifts low powers instead.
 *  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c#L192-L215
 *  https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/spindle_control.c#L1045-L1078
 *  A Job Review warning, never a Start guard (ADR-565). */
export function laserMinPowerNonzeroMessage(
  minS: number,
  maxS: number | undefined,
  firmware: PowerRangeFirmware,
): string {
  const lead = `Controller $31 minimum S is ${minS}.`;
  const example =
    maxS === undefined || maxS / 2 <= minS
      ? ''
      : ` (50% runs at about ${Math.round(((maxS / 2 - minS) / (maxS - minS)) * 100)}%)`;
  const floorShare =
    maxS === undefined ? '' : ` (powers up to ${Number(((minS / maxS) * 100).toFixed(1))}%)`;
  const advice = 'Set $31=0 so power maps from zero.';
  switch (firmware) {
    case 'grbl':
      return `${lead} Stock GRBL maps S from $31 up to $30, so every power below 100% burns weaker than set${example}, and any S at or below $31${floorShare} fires only at the lowest PWM step, about 0.4%. ${advice}`;
    case 'grblhal':
      return `${lead} grblHAL maps S from $31 up to $30, so with $35=0 every power below 100% burns weaker than set${example}, and any S at or below $31${floorShare} fires only at the $35 PWM minimum, about 0.4% when $35=0. A raised $35 lifts low powers instead. ${advice}`;
    case 'fluidnc':
    case 'unknown':
      return `${lead} GRBL-family firmware maps S from $31 up to $30, so every power below 100% burns weaker than set${example}, and any S at or below $31${floorShare} fires only at the PWM minimum: about 0.4% on stock GRBL, or grblHAL's $35. ${advice}`;
  }
}

export function spindleScaleMismatchMessage(
  controllerMaxPowerS: number,
  spindleMaxRpm: number,
  source: ReadinessSettingsSource,
): string {
  const mismatch = `Controller $30 is ${controllerMaxPowerS} but this machine's spindle max RPM is ${spindleMaxRpm}.`;
  return source === 'fluidnc-yaml'
    ? `${mismatch} FluidNC reports $30 from the top of the spindle's speed_map in its YAML config: change speed_map there to reach ${spindleMaxRpm}, or update the machine profile, so S values map to real RPM.`
    : `${mismatch} Set $30=${spindleMaxRpm} (or update the machine profile) so S values map to real RPM.`;
}

// GRBL's laser mode passes zero spindle speed on every non-cutting motion and
// skips the spin-up delay, at the dwell after M3 and on Resume (CNC audit JR-1,
// MC-1: gcode.c, protocol.c).
const ROUTER_LASER_MODE_EFFECTS =
  'in laser mode the spindle only turns during cutting moves, so the spin-up dwell after M3 runs with it off, plunges start with the bit not at speed, and Resume after a pause restarts motion with no spin-up.';

export const CNC_LASER_MODE_ENABLED_MESSAGE = `Controller reports $32=1 (laser mode). Set $32=0 for spindle work: ${ROUTER_LASER_MODE_EFFECTS}`;

export const FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE = `Controller reports $32=1: its spindle is configured as Laser. FluidNC's $32 follows the spindle type and cannot be set with $32=0, so configure the router's spindle (not Laser) in the FluidNC YAML config for spindle work: ${ROUTER_LASER_MODE_EFFECTS}`;

export function routerLaserModeMessage(source: ReadinessSettingsSource): string {
  return source === 'fluidnc-yaml'
    ? FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE
    : CNC_LASER_MODE_ENABLED_MESSAGE;
}
