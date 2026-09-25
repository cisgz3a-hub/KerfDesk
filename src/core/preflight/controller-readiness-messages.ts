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
