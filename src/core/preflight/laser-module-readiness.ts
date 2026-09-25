// What the firmware's own laser-module report means for laser output
// (controller audit SM-3, SM-2). The evidence comes from the qualification
// probe (Smoothieware `M221`, core/controllers/smoothieware/laser-module.ts).
//
// - No Laser module: S words do nothing and nothing answers `fire`
//   (SimpleShell.cpp L286-L288; GcodeDispatch ignores lowercase lines). Test
//   Fire is refused, because its `fire` line would never be answered. A laser
//   job is not refused (PROJECT.md non-negotiable 21, ADR-397): Job Review says
//   it will run with the laser off, and the streamed program leaves out its
//   `fire off`, which would stall the stream on its first line.
// - A module without M221 P (a build before edge 971eb8cf, 2021-06-15): every
//   G1-G3 block runs speed-proportional, so a constant-power (M3) layer burns
//   lighter at corners and on short segments. A Job Review warning only.

import type { LaserModuleEvidence } from '../controllers/controller-driver';
import { SMOOTHIE_CMD_FIRE_OFF } from '../controllers/smoothieware/commands';

const LASER_MODULE_NOT_LOADED =
  'Smoothieware answered M221 without a "Laser power" line, so its Laser module is not loaded (laser_module_enable is not true, or the laser pin is not a hardware-PWM pin).';
const ENABLE_LASER_MODULE =
  'Enable the Laser module in the Smoothieware config, reset the board and reconnect.';

export const LASER_MODULE_ABSENT_MESSAGE = `The controller cannot fire the laser: ${LASER_MODULE_NOT_LOADED} ${ENABLE_LASER_MODULE}`;

export const LASER_MODULE_ABSENT_JOB_WARNING = `This job will not burn: ${LASER_MODULE_NOT_LOADED} The head runs the job with the laser off. ${ENABLE_LASER_MODULE}`;

export const CONSTANT_POWER_UNSUPPORTED_MESSAGE =
  'This job has constant-power (M3) layers, but the connected Smoothieware build answered M221 without a "disable auto power" field, so it predates M221 P (edge 971eb8cf, 2021-06-15). On this build those layers run speed-proportional: power drops at corners and on short segments. Update the firmware for constant power.';

// The Smoothieware strategy writes a constant-power layer's M3 as
// `M221 S100 P1` (smoothieware-strategy.ts nativePowerModes).
const CONSTANT_POWER_LINE_RE = /^M221\b[^\n;(]*\bP0*[1-9]/im;

/** Why test Fire cannot run, or null: a `fire` line is never answered
 *  without the Laser module. */
export function laserFireRefusal(evidence: LaserModuleEvidence | null | undefined): string | null {
  return evidence?.module === 'absent' ? LASER_MODULE_ABSENT_MESSAGE : null;
}

/** Job Review warning for a laser job on a board without its Laser module. */
export function laserModuleAbsentJobWarning(
  evidence: LaserModuleEvidence | null | undefined,
): string | null {
  return evidence?.module === 'absent' ? LASER_MODULE_ABSENT_JOB_WARNING : null;
}

/** The program a board streams: without the Laser module nothing answers
 *  `fire off`, so it is left out; everything else is answered. */
export function programForLaserModule(
  gcode: string,
  evidence: LaserModuleEvidence | null | undefined,
): string {
  if (evidence?.module !== 'absent') return gcode;
  return gcode
    .split('\n')
    .filter((line) => line.trim() !== SMOOTHIE_CMD_FIRE_OFF)
    .join('\n');
}

/** Job Review warning for constant-power output on a build without M221 P. */
export function constantPowerModeWarning(
  gcode: string,
  evidence: LaserModuleEvidence | null | undefined,
): string | null {
  if (evidence?.module !== 'loaded' || evidence.constantPowerMode !== false) return null;
  return CONSTANT_POWER_LINE_RE.test(gcode) ? CONSTANT_POWER_UNSUPPORTED_MESSAGE : null;
}
