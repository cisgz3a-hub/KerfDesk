// What the firmware's own laser-module report means for laser output
// (controller audit SM-3, SM-2). The evidence comes from the qualification
// probe (Smoothieware `M221`, core/controllers/smoothieware/laser-module.ts).
//
// - No Laser module: the board cannot run laser output at all. S words do
//   nothing and nothing answers `fire`, so a laser job or its Frame is refused
//   with that transport/output fact. This is not a policy gate.
// - A module without M221 P (a build before edge 971eb8cf, 2021-06-15): every
//   G1-G3 block runs speed-proportional, so a constant-power (M3) layer burns
//   lighter at corners and on short segments. A Job Review warning only.

import type { LaserModuleEvidence } from '../controllers/controller-driver';

export const LASER_MODULE_ABSENT_MESSAGE =
  'The controller cannot run laser output: Smoothieware answered M221 without a "Laser power" line, so its Laser module is not loaded (laser_module_enable is not true, or the laser pin is not a hardware-PWM pin). Enable the Laser module in the Smoothieware config, reset the board and reconnect.';

export const CONSTANT_POWER_UNSUPPORTED_MESSAGE =
  'This job has constant-power (M3) layers, but the connected Smoothieware build answered M221 without a "disable auto power" field, so it predates M221 P (edge 971eb8cf, 2021-06-15). On this build those layers run speed-proportional: power drops at corners and on short segments. Update the firmware for constant power.';

// The Smoothieware strategy writes a constant-power layer's M3 as
// `M221 S100 P1` (smoothieware-strategy.ts nativePowerModes).
const CONSTANT_POWER_LINE_RE = /^M221\b[^\n;(]*\bP0*[1-9]/im;

/** The factual refusal for live laser output, or null. */
export function laserOutputRefusal(
  evidence: LaserModuleEvidence | null | undefined,
): string | null {
  return evidence?.module === 'absent' ? LASER_MODULE_ABSENT_MESSAGE : null;
}

/** Job Review warning for constant-power output on a build without M221 P. */
export function constantPowerModeWarning(
  gcode: string,
  evidence: LaserModuleEvidence | null | undefined,
): string | null {
  if (evidence?.module !== 'loaded' || evidence.constantPowerMode !== false) return null;
  return CONSTANT_POWER_LINE_RE.test(gcode) ? CONSTANT_POWER_UNSUPPORTED_MESSAGE : null;
}
