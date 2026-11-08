// A CNC machine that may be a laser KerfDesk 1.0.29 set up as a CNC (rolling
// audit v10 V2-P2-2, ADR-637 Amendment 8). On its first Connect to a stock
// GRBL with laser mode off ($32=0), 1.0.29's fill turned the generic laser
// starter into a CNC, and Save kept it. Amendment 7 stopped that for new
// Connects only, so those machines still restore as CNCs, and a CNC Start
// sends `M3 S12000`, a 3 s dwell and rapids with no `S0`: on a diode, full
// power held still, then lit travel.
//
// Nothing in the saved machine proves which it is: a router owner who chose
// CNC on the starter has the same document. So this only says whether to ask.
// Pure: no storage and no React. The operator's answer is kept by the UI.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { explicitMachineKindsForProfile } from '../devices/device-profile';
import { DEFAULT_CNC_MACHINE_PARAMS, type CncMachineParams, type MachineConfig } from '../scene';

/** The largest `$30` a laser's power scale uses. GRBL's own default is 1000,
 *  and laser kits ship 1000 or 255. A larger `$30` is a spindle's RPM, set by
 *  someone who configured a router. */
export const LASER_POWER_SCALE_CEILING = 1000;

/** What the connected controller reported, when it was read this session. */
export type ConvertedLaserControllerReport = {
  /** `$32` as reported. Only GRBL 1.1 and its descendants have laser mode. */
  readonly laserModeEnabled?: boolean;
  /** `$30` as reported. */
  readonly maxPowerS?: number;
  /** The `[VER:…]` protocol version, such as `1.1h`. */
  readonly protocolVersion?: string;
};

/** A controller fact that agrees with a laser. None of them tells a laser
 *  from a stock router; they are named in the question so it reads true. */
export type ConvertedLaserHint =
  | { readonly kind: 'laser-mode'; readonly enabled: boolean }
  | { readonly kind: 'laser-power-scale'; readonly maxPowerS: number }
  | { readonly kind: 'grbl-1-1'; readonly protocolVersion: string };

export type ConvertedLaserSuspicion = {
  readonly hints: ReadonlyArray<ConvertedLaserHint>;
};

/**
 * Whether to ask if this CNC machine is really a laser. All three must hold:
 * - it is a CNC made from KerfDesk's laser starter (its profile id, and CNC as
 *   its only output), as 1.0.29's fill left it;
 * - nobody set its spindle: max RPM, spin-up and coolant are KerfDesk's
 *   defaults;
 * - the controller, if read, does not report a spindle's `$30`.
 * Returns null when there is nothing to ask.
 */
export function convertedLaserSuspicion(input: {
  readonly profile: DeviceProfile;
  readonly machine: MachineConfig | undefined;
  readonly controller?: ConvertedLaserControllerReport | null;
}): ConvertedLaserSuspicion | null {
  const { machine } = input;
  if (machine?.kind !== 'cnc') return null;
  if (!madeFromLaserStarter(input.profile)) return null;
  if (!spindleUntouched(machine.params)) return null;
  const controller = input.controller ?? null;
  if (controller?.maxPowerS !== undefined && controller.maxPowerS > LASER_POWER_SCALE_CEILING) {
    return null;
  }
  return { hints: controllerHints(controller) };
}

// 1.0.29's Save gave it CNC as its only output. The plain starter declares no
// output kind, so a CNC on it is the toolbar's Laser/CNC switch, not the fill;
// a starter that declares a laser head as well is its owner's two-tool machine.
function madeFromLaserStarter(profile: DeviceProfile): boolean {
  if (profile.profileId !== DEFAULT_DEVICE_PROFILE.profileId) return false;
  const kinds = explicitMachineKindsForProfile(profile);
  return kinds.length === 1 && kinds[0] === 'cnc';
}

function spindleUntouched(params: CncMachineParams): boolean {
  return (
    params.spindleMaxRpm === DEFAULT_CNC_MACHINE_PARAMS.spindleMaxRpm &&
    params.spindleSpinupSec === DEFAULT_CNC_MACHINE_PARAMS.spindleSpinupSec &&
    // An absent coolant is off (machine.ts), as the default is.
    (params.coolant ?? 'off') === (DEFAULT_CNC_MACHINE_PARAMS.coolant ?? 'off')
  );
}

function controllerHints(
  controller: ConvertedLaserControllerReport | null,
): ReadonlyArray<ConvertedLaserHint> {
  if (controller === null) return [];
  const hints: ConvertedLaserHint[] = [];
  if (controller.laserModeEnabled !== undefined) {
    hints.push({ kind: 'laser-mode', enabled: controller.laserModeEnabled });
  }
  if (controller.maxPowerS !== undefined && controller.maxPowerS > 0) {
    hints.push({ kind: 'laser-power-scale', maxPowerS: controller.maxPowerS });
  }
  if (controller.protocolVersion?.startsWith('1.1') === true) {
    hints.push({ kind: 'grbl-1-1', protocolVersion: controller.protocolVersion });
  }
  return hints;
}
