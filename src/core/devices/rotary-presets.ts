// Rotary attachments with published settings (ADR-503). Only figures a maker
// publishes go here; every rotary still wants a Test rotation on its machine,
// because the motion per turn depends on how the controller drives the port
// the rotary plugs into.

import type { DeviceProfile } from './device-profile';
import type { RotarySetup } from './rotary';

export type RotaryPreset = {
  readonly id: string;
  readonly label: string;
  /** The machine families it fits (DeviceProfile.machineFamily). */
  readonly machineFamilies: ReadonlyArray<string>;
  readonly setup: Pick<RotarySetup, 'type' | 'mmPerRotation'>;
  /** Where the figures come from, as the Rotary Setup shows it. */
  readonly source: string;
};

export const ROTARY_PRESETS: ReadonlyArray<RotaryPreset> = [
  {
    id: 'creality-rotary-kit-pro-chuck',
    label: 'Creality Rotary Kit Pro, chuck',
    machineFamilies: ['creality-falcon'],
    setup: { type: 'chuck', mmPerRotation: 40 },
    source:
      'Creality’s manual for the Rotary Kit Pro (4-in-1) sets 40 mm per rotation as a chuck on the Y port and says the value may vary with the setup (https://manuals.plus/asin/B0CMXCFNB2). Check it with Test rotation.',
  },
];

export function rotaryPresetsFor(
  device: Pick<DeviceProfile, 'machineFamily'>,
): ReadonlyArray<RotaryPreset> {
  const family = device.machineFamily;
  if (family === undefined) return [];
  return ROTARY_PRESETS.filter((preset) => preset.machineFamilies.includes(family));
}
