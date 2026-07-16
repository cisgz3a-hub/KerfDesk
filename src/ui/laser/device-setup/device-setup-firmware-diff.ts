// device-setup-firmware-diff.ts — pure comparison between the Machine Setup
// draft and the controller's last $$ readback. Only settings GRBL marks as
// 'common'-risk are writable here, matching the existing FirmwareWrites guard;
// machine-critical ones (bed travel) are surfaced read-only for awareness.

import type { GrblSettingRow } from '../../../core/controllers/grbl';
import type { DeviceProfile } from '../../../core/devices';
import { explicitMachineKindsForProfile } from '../../../core/devices/device-profile';
import type { CncMachineConfig, MachineConfig, MachineKind } from '../../../core/scene';
import { numbersClose } from '../../../core/util';
import { presentGrblSetting } from '../machine-settings-presentation';

export type FirmwareDiff = {
  readonly id: number;
  readonly code: `$${number}`;
  readonly label: string;
  // The controller's current raw readback value (verbatim from `$$`).
  readonly current: string;
  // What the draft profile wants this setting to be.
  readonly desired: string;
  readonly differs: boolean;
  // Whether the wizard may offer to write this (GRBL 'common'-risk only).
  readonly writable: boolean;
};

type DiffedSetting = {
  readonly id: number;
  readonly label?: string;
  readonly desired: number;
};

export type ComputeFirmwareDiffOptions = {
  readonly machine?: MachineConfig;
  readonly machineKinds?: ReadonlyArray<MachineKind>;
};

export function computeFirmwareDiffs(
  draft: DeviceProfile,
  rows: ReadonlyArray<GrblSettingRow>,
  options: ComputeFirmwareDiffOptions = {},
): ReadonlyArray<FirmwareDiff> {
  const cnc = options.machine?.kind === 'cnc' ? options.machine : null;
  const activeMachineKind = cnc === null ? 'laser' : 'cnc';
  const context = {
    machineKinds: options.machineKinds ?? explicitMachineKindsForProfile(draft),
    activeMachineKind,
  } satisfies {
    readonly machineKinds: ReadonlyArray<MachineKind>;
    readonly activeMachineKind: MachineKind;
  };
  return diffedSettings(draft, cnc).flatMap((setting) => {
    const row = rows.find((candidate) => candidate.id === setting.id);
    // Only diff settings the controller actually reported; an unread setting
    // is not something we can confidently reconcile.
    if (row === undefined) return [];
    const desired = setting.desired;
    const current = row.numericValue;
    return [
      {
        id: setting.id,
        code: row.code,
        label: setting.label ?? presentGrblSetting(row, context).name,
        current: row.rawValue,
        desired: String(desired),
        differs: current !== null && !numbersClose(current, desired),
        writable: row.writeRisk === 'common',
      },
    ];
  });
}

// $30/$31/$32 share one controller PWM block, but the profile only has a
// trustworthy $31 source for Laser output. CNC profiles currently define a
// spindle maximum, not a minimum, so CNC review must not borrow laser minPowerS.
function diffedSettings(
  draft: DeviceProfile,
  cnc: CncMachineConfig | null,
): ReadonlyArray<DiffedSetting> {
  return [
    { id: 30, desired: cnc?.params.spindleMaxRpm ?? draft.maxPowerS },
    ...(cnc === null ? [{ id: 31, desired: draft.minPowerS }] : []),
    { id: 32, desired: cnc === null && draft.laserModeEnabled ? 1 : 0 },
    { id: 130, label: 'Bed width', desired: draft.bedWidth },
    { id: 131, label: 'Bed height', desired: draft.bedHeight },
  ];
}
