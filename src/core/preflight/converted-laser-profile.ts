// A CNC machine that may be a laser KerfDesk 1.0.29 set up as a CNC (rolling
// audit v10 V2-P2-2, ADR-637 Amendment 8). On its first Connect to a stock
// GRBL with laser mode off ($32=0), 1.0.29's fill turned any unlisted laser
// (the generic starter, a LightBurn import, a profile with no id) into a CNC,
// and Save kept it. Amendment 7 stopped that for new Connects only, so those
// machines still restore as CNCs, and a CNC Start sends `M3 S<max>`, a dwell
// and rapids with no `S0`: on a diode, full power held still, then lit travel.
//
// Nothing in the saved machine proves which it is: a router owner who chose
// CNC on the starter has the same document. So this only says whether to ask,
// and only the operator's answer ends the question (Amendment 10): spindle
// edits and a spindle-scale `$30` are what 1.0.29's own advice told a laser
// owner to make, so they are not answers. Pure: no storage and no React. The
// operator's answer is kept by the UI.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { explicitMachineKindsForProfile } from '../devices/device-profile';
import type { MachineConfig } from '../scene';

/** The largest `$30` a laser's power scale uses. GRBL's own default is 1000,
 *  and laser kits ship 1000 or 255. A larger `$30` is a spindle's RPM scale. */
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
 * Whether to ask if this CNC machine is really a laser: it is a CNC whose
 * profile 1.0.29's fill could have made from a laser. That is CNC as its only
 * declared output on a profile that is not a listed machine: KerfDesk's laser
 * starter, a LightBurn device import, or a profile with no id. Its spindle
 * values and the controller's `$30` do not end the question (Amendment 10).
 * Returns null when there is nothing to ask.
 */
export function convertedLaserSuspicion(input: {
  readonly profile: DeviceProfile;
  readonly machine: MachineConfig | undefined;
  readonly controller?: ConvertedLaserControllerReport | null;
}): ConvertedLaserSuspicion | null {
  if (input.machine?.kind !== 'cnc') return null;
  if (!cncOnlyProfile(input.profile) || !laserBefore1029Fill(input.profile)) return null;
  return { hints: controllerHints(input.controller ?? null) };
}

// 1.0.29's Save gave it CNC as its only output. The plain starter declares no
// output kind, so a CNC on it is the toolbar's Laser/CNC switch, not the fill;
// a profile that declares a laser head as well is its owner's two-tool machine.
function cncOnlyProfile(profile: DeviceProfile): boolean {
  const kinds = explicitMachineKindsForProfile(profile);
  return kinds.length === 1 && kinds[0] === 'cnc';
}

// The profiles 1.0.29's fill converted at `$32=0`: any unlisted laser draft
// (df2279e26 device-setup-auto-fill.ts machineKindFromLaserMode). A listed
// machine kept its type, so a catalog router or laser is not asked.
function laserBefore1029Fill(profile: DeviceProfile): boolean {
  const id = profile.profileId;
  return (
    id === undefined ||
    id === DEFAULT_DEVICE_PROFILE.profileId ||
    id.startsWith('lightburn-') ||
    profile.profileSource === 'lightburn'
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
  const scale = controller.maxPowerS;
  if (scale !== undefined && scale > 0 && scale <= LASER_POWER_SCALE_CEILING) {
    hints.push({ kind: 'laser-power-scale', maxPowerS: scale });
  }
  if (controller.protocolVersion?.startsWith('1.1') === true) {
    hints.push({ kind: 'grbl-1-1', protocolVersion: controller.protocolVersion });
  }
  return hints;
}
