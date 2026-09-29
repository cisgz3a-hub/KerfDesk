// The authoritative gate for a guarded Machine Settings `$x=` write: the read
// gate, a fresh Idle, a settings read in this connection, a known writable
// setting, the machine-kind rules and a value the firmware can store as typed
// (controller audit 2026-09-25 GP-5 for stock GRBL's integer settings).

import type { ControllerDriver } from '../../core/controllers';
import type { GrblSettingRow } from '../../core/controllers/grbl';
import { stockGrblSettingStorageIssue } from '../../core/controllers/grbl/grbl-setting-storage';
import { grblSettingMachineKindIssue } from '../../core/controllers/grbl/grbl-setting-write';
import type { MachineKind } from '../../core/scene';
import type { LaserState } from './laser-store';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';

type WriteReadinessRefs = {
  readonly driver: Pick<ControllerDriver, 'kind'>;
  readonly settingsCollector: { readonly kind: string };
};

export function machineSettingsWriteBlockReason(
  state: LaserState,
  refs: WriteReadinessRefs,
  machineKind: MachineKind,
  id: number,
  value: string,
): string | null {
  const readBlocked = machineSettingsReadBlockReason(state, {
    settingsCollectionActive: refs.settingsCollector.kind === 'collecting',
  });
  if (readBlocked !== null) return readBlocked;
  if (state.statusReport?.state !== 'Idle') {
    return 'Machine must report Idle before writing firmware settings.';
  }
  // The write checks its row against, and verifies by re-reading, the settings
  // read in this connection; that read is all this gate can see. Export
  // records nothing, so the message must not claim a backup was required.
  // Machine Setup asks the operator to confirm the export instead (ADR-375).
  if (state.grblSettingsRows.length === 0 || state.lastSettingsReadAt === null) {
    return 'Read the controller settings before writing firmware settings.';
  }
  const row = state.grblSettingsRows.find((candidate) => candidate.id === id);
  if (row === undefined || row.writeRisk === 'unknown' || row.writeRisk === 'read-only') {
    return `Cannot write unknown or read-only GRBL setting $${id}.`;
  }
  const machineKindIssue = grblSettingMachineKindIssue(machineKind, id, value);
  if (machineKindIssue !== null) return machineKindIssue;
  return validateSettingValue(row, value, refs.driver.kind);
}

function validateSettingValue(
  row: GrblSettingRow,
  value: string,
  driverKind: ControllerDriver['kind'],
): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return `${row.code} value is required.`;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return `${row.code} value must be numeric.`;
  if (row.id === 32 && trimmed !== '0' && trimmed !== '1') {
    return '$32 laser mode must be 0 or 1.';
  }
  if (row.id === 31 && parsed < 0) return '$31 min S must be non-negative.';
  if (row.id === 30 && parsed <= 0) return '$30 max S must be positive.';
  return driverKind === 'grbl-v1.1' ? stockGrblSettingStorageIssue(row.id, parsed) : null;
}
