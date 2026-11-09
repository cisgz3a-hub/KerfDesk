// Rotary attachments with published settings (ADR-503, ADR-693). Only figures
// a maker publishes go here, each with its source; every rotary still wants a
// Test rotation on its machine, because the motion per turn depends on how the
// controller drives the port the rotary plugs into. Each preset names that
// port as an axis, so a machine whose rotary connector is not the Y port is
// never offered a Y-port figure.
//
// Searched and left out for want of a readable maker figure (2026-11-10):
// Ortur YRR / YRC, Sculpfun's roller, Atomstack R3 / R3 Pro, and LaserPecker's
// rotary extension (the LP4 switches rotary mode in firmware with M3032 and
// publishes no per-turn figure).

import type { ControllerCommandSet, DeviceProfile } from './device-profile';
import type { DedicatedRotaryAxis, RotarySetup } from './rotary';

export type RotaryPreset = {
  readonly id: string;
  readonly label: string;
  /** The machine families it fits (DeviceProfile.machineFamily). */
  readonly machineFamilies: ReadonlyArray<string>;
  /** Only machines on this vendor command set, or 'none' for machines on none.
   *  Absent: any. Tells the Falcon A1 Pro, whose rotary has its own connector,
   *  from the Falcons whose rotary takes the Y motor's place. */
  readonly commandSet?: ControllerCommandSet | 'none';
  readonly setup: Pick<RotarySetup, 'type' | 'mmPerRotation'> & {
    /** The axis the maker's port is. Absent keeps the operator's choice. */
    readonly axis?: RotarySetup['axis'];
    /** A roller's driven-roller diameter, when the maker publishes it. */
    readonly roller?: { readonly diameterMm: number };
  };
  /** Where the figures come from, as the Rotary Setup shows it. */
  readonly source: string;
};

const CREALITY_A1_GUIDE =
  'https://wiki.creality.com/en/laser-engraver/falcon-a1/random-data/guide-A';
const XTOOL_LIGHTBURN_ROTARY = 'https://support.xtool.com/article/588';

export const ROTARY_PRESETS: ReadonlyArray<RotaryPreset> = [
  {
    id: 'creality-rotary-kit-pro-chuck',
    label: 'Creality Rotary Kit Pro, chuck, on the Y port',
    machineFamilies: ['creality-falcon'],
    commandSet: 'none',
    setup: { type: 'chuck', axis: 'Y', mmPerRotation: 40 },
    source:
      'Creality’s manual for the Rotary Kit Pro (4-in-1) sets 40 mm per rotation as a chuck on the Y port and says the value may vary with the setup (https://manuals.plus/asin/B0CMXCFNB2). For a Falcon whose rotary plugs into the Y motor port. Check it with Test rotation.',
  },
  {
    id: 'creality-rotary-kit-pro-chuck-a1-pro',
    label: 'Creality Rotary Kit Pro, chuck, on the A1 Pro’s rotary connector (A axis)',
    machineFamilies: ['creality-falcon'],
    commandSet: 'creality-falcon-a1-pro',
    setup: { type: 'chuck', axis: 'A', mmPerRotation: 360 },
    source:
      `Creality’s Falcon A1/A1 Pro rotating kit guide says to connect the rotary to the A axis (${CREALITY_A1_GUIDE}). ` +
      'Two published A1 Pro $I reads list the axes XYZA, with $103=8.900 steps per degree (https://github.com/barebaric/rayforge/pull/461), so 360° is one turn of a 3200-step rotary motor. ' +
      'LightBurn forum users report one turn at 360 on an A1, one of them on Z (https://forum.lightburnsoftware.com/t/rotary-setup-falcon-a1-pro/189774). ' +
      'Not checked on a machine: if Test rotation does not turn the chuck, choose Z. KerfDesk asks you to confirm a Test rotation before the first burn.',
  },
  {
    id: 'xtool-ra2-pro-chuck',
    label: 'xTool RA2 Pro, chuck',
    machineFamilies: ['xtool-d1-pro'],
    setup: { type: 'chuck', axis: 'Y', mmPerRotation: 128 },
    source: `xTool’s LightBurn rotary guide sets the RA2 Pro chuck to 128 mm per rotation, a fixed value, on the Y axis of a D1 Pro (the Z axis on a D1) (${XTOOL_LIGHTBURN_ROTARY}). Check it with Test rotation.`,
  },
  {
    id: 'xtool-ra2-pro-roller',
    label: 'xTool RA2 Pro, roller',
    machineFamilies: ['xtool-d1-pro'],
    setup: { type: 'roller', axis: 'Y', mmPerRotation: 32, roller: { diameterMm: 17 } },
    source: `xTool’s LightBurn rotary guide sets the RA2 Pro and RA1 rollers to 32 mm per rotation and a 17 mm roller diameter, both fixed, on the Y axis of a D1 Pro (the Z axis on a D1) (${XTOOL_LIGHTBURN_ROTARY}). Check it with Test rotation.`,
  },
];

/**
 * The dedicated axis this machine's rotary connector is, when every preset its
 * maker publishes for it names the same one (the Falcon A1 Pro's A), or null.
 * Data, so a reading of the maintainer's own machine changes only the preset.
 */
export function rotaryConnectorAxisFor(
  device: Pick<DeviceProfile, 'machineFamily' | 'controllerCommandSet'>,
): DedicatedRotaryAxis | null {
  const axes = new Set(rotaryPresetsFor(device).map((preset) => preset.setup.axis ?? 'Y'));
  const [only] = [...axes];
  return axes.size === 1 && only !== undefined && only !== 'Y' ? only : null;
}

export function rotaryPresetsFor(
  device: Pick<DeviceProfile, 'machineFamily' | 'controllerCommandSet'>,
): ReadonlyArray<RotaryPreset> {
  const family = device.machineFamily;
  if (family === undefined) return [];
  const commandSet = device.controllerCommandSet ?? 'none';
  return ROTARY_PRESETS.filter(
    (preset) =>
      preset.machineFamilies.includes(family) &&
      (preset.commandSet === undefined || preset.commandSet === commandSet),
  );
}
