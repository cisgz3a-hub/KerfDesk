// Laser modules a machine takes one at a time (ADR-503). The Falcon A1 Pro's
// 20 W blue diode and its 2 W infrared module swap on the same carriage: only
// one is ever fitted, so the machine profile's laserSubProfile is the fitted
// module and picking another swaps it. The G-code does not change; the beam,
// wavelength and power that recipes, the burn preview, tracing and the
// spot-size checks read do.

import type { DeviceProfile, LaserSubProfile } from './device-profile';

export const FALCON_A1_PRO_BLUE_20W_MODULE: LaserSubProfile = {
  model: 'Falcon A1 Pro 20 W blue module',
  technology: 'diode',
  metadataConfidence: 'researched',
  opticalPowerW: 20,
  wavelengthNm: 455,
  spotSizeMm: { x: 0.08, y: 0.1 },
  focusMode: 'unknown',
  airAssist: 'built-in',
  notes:
    'Creality lists 20 W at 455 ± 5 nm (https://www.crealityfalcon.com/products/falcon-a1-pro-20w-dual-laser-engraver); Tom’s Hardware’s review lists a 0.08 × 0.1 mm spot (https://www.tomshardware.com/maker-stem/creality-falcon-a1-pro-20-watt-review). Focus is by the machine’s autofocus ($HZ1). Not measured on a machine.',
};

export const FALCON_A1_PRO_INFRARED_2W_MODULE: LaserSubProfile = {
  model: 'Falcon A1 Pro 2 W infrared module',
  technology: 'unknown',
  metadataConfidence: 'researched',
  opticalPowerW: 2,
  wavelengthNm: 1064,
  spotSizeMm: { x: 0.03, y: 0.03 },
  focusMode: 'unknown',
  airAssist: 'unknown',
  notes:
    'Creality lists 2 W at 1064 ± 1 nm with a 0.03 mm spot, swapped with the blue module on the same carriage (https://www.crealityfalcon.com/products/falcon-a1-pro-20w-dual-laser-engraver). Creality does not say what kind of source it is or whether the air nozzle serves it. Not measured on a machine.',
};

type ModuleSet = {
  readonly profileIds: ReadonlyArray<string>;
  readonly modules: ReadonlyArray<LaserSubProfile>;
};

const MODULE_SETS: ReadonlyArray<ModuleSet> = [
  {
    profileIds: ['creality-falcon-a1-pro-grblhal'],
    modules: [FALCON_A1_PRO_BLUE_20W_MODULE, FALCON_A1_PRO_INFRARED_2W_MODULE],
  },
];

/** The modules this machine takes one at a time; empty for a single laser. */
export function laserModulesFor(
  device: Pick<DeviceProfile, 'profileId'>,
): ReadonlyArray<LaserSubProfile> {
  const id = device.profileId;
  if (id === undefined) return [];
  return MODULE_SETS.find((set) => set.profileIds.includes(id))?.modules ?? [];
}

/** Which of the machine's modules is fitted, by model; -1 for none of them. */
export function fittedLaserModuleIndex(
  device: Pick<DeviceProfile, 'profileId' | 'laserSubProfile'>,
): number {
  const fitted = device.laserSubProfile?.model;
  if (fitted === undefined) return -1;
  return laserModulesFor(device).findIndex((module) => module.model === fitted);
}

/** A short name for a module: its power and wavelength. */
export function laserModuleLabel(module: LaserSubProfile): string {
  const parts = [
    module.opticalPowerW === undefined ? null : `${module.opticalPowerW} W`,
    module.wavelengthNm === undefined ? null : wavelengthName(module.wavelengthNm),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? module.model : parts.join(' ');
}

function wavelengthName(nm: number): string {
  if (nm >= 430 && nm <= 470) return `blue (${nm} nm)`;
  if (nm >= 1000 && nm <= 1100) return `infrared (${nm} nm)`;
  if (nm >= 9000) return `CO₂ (${nm} nm)`;
  return `${nm} nm`;
}
