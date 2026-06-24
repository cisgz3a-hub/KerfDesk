// device-setup-firmware-diff.ts — pure comparison between the wizard's draft
// profile and the controller's last $$ readback, used by the Sync step
// (ADR-092) to offer guarded firmware writes. Only settings GRBL marks as
// 'common'-risk are writable here, matching the existing FirmwareWrites guard;
// machine-critical ones (bed travel) are surfaced read-only for awareness.

import type { DeviceProfile } from '../../../core/devices';
import type { GrblSettingRow } from '../../../core/controllers/grbl';

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
  readonly label: string;
  readonly desired: (draft: DeviceProfile) => number;
};

// The settings the wizard reconciles. $30/$31/$32 are 'common'-risk and
// writable through the existing guard; $130/$131 are machine-critical and
// included read-only so a bed mismatch is visible without offering a risky
// write here (use the batch GRBL setup for those).
const DIFFED_SETTINGS: ReadonlyArray<DiffedSetting> = [
  { id: 30, label: 'Max power (S)', desired: (d) => d.maxPowerS },
  { id: 31, label: 'Min power (S)', desired: (d) => d.minPowerS },
  { id: 32, label: 'Laser mode', desired: (d) => (d.laserModeEnabled ? 1 : 0) },
  { id: 130, label: 'Bed width', desired: (d) => d.bedWidth },
  { id: 131, label: 'Bed height', desired: (d) => d.bedHeight },
];

const COMPARE_EPSILON = 0.001;

export function computeFirmwareDiffs(
  draft: DeviceProfile,
  rows: ReadonlyArray<GrblSettingRow>,
): ReadonlyArray<FirmwareDiff> {
  return DIFFED_SETTINGS.flatMap((setting) => {
    const row = rows.find((candidate) => candidate.id === setting.id);
    // Only diff settings the controller actually reported; an unread setting
    // is not something we can confidently reconcile.
    if (row === undefined) return [];
    const desired = setting.desired(draft);
    const current = row.numericValue;
    return [
      {
        id: setting.id,
        code: row.code,
        label: setting.label,
        current: row.rawValue,
        desired: String(desired),
        differs: current !== null && !numbersClose(current, desired),
        writable: row.writeRisk === 'common',
      },
    ];
  });
}

function numbersClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff < COMPARE_EPSILON) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / denom < COMPARE_EPSILON;
}
