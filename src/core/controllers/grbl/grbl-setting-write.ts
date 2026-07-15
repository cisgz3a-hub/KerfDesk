import type { GrblSettingRow } from './grbl-settings';
import type { MachineKind } from '../../scene';

export type GrblSettingWriteConfirmation = {
  readonly commonSettingChecked?: boolean;
  readonly typedCommand?: string;
};

export type BuildGrblSettingWriteInput = {
  readonly rows: ReadonlyArray<GrblSettingRow>;
  readonly id: number;
  readonly value: string;
  readonly machineKind: MachineKind;
  readonly confirmation: GrblSettingWriteConfirmation;
  readonly backupFresh: boolean;
};

export type BuildGrblSettingWriteResult =
  | { readonly kind: 'ok'; readonly command: `$${number}=${string}` }
  | { readonly kind: 'blocked'; readonly reason: string };

const COMMON_WRITABLE_SETTINGS = new Set([30, 31, 32]);

export function buildGrblSettingWrite(
  input: BuildGrblSettingWriteInput,
): BuildGrblSettingWriteResult {
  const row = input.rows.find((candidate) => candidate.id === input.id);
  const normalizedValue = input.value.trim();
  if (row === undefined) {
    return blocked(`Setting $${input.id} has not been read from the controller.`);
  }
  if (!input.backupFresh) {
    return blocked('Export a fresh controller settings backup before writing firmware settings.');
  }
  if (!row.known || row.writeRisk === 'unknown' || row.writeRisk === 'read-only') {
    return blocked(`${row.code} is read-only or unknown in KerfDesk metadata.`);
  }
  if (!isValidGrblSettingValue(row.id, normalizedValue)) {
    return blocked(`${row.code} value is not valid for a guarded GRBL write.`);
  }
  const machineKindIssue = grblSettingMachineKindIssue(input.machineKind, row.id, normalizedValue);
  if (machineKindIssue !== null) return blocked(machineKindIssue);

  const command = `$${row.id}=${normalizedValue}` as `$${number}=${string}`;
  if (COMMON_WRITABLE_SETTINGS.has(row.id)) {
    return input.confirmation.commonSettingChecked === true
      ? { kind: 'ok', command }
      : blocked(`Confirm the checkbox before writing common laser setting ${row.code}.`);
  }
  if (row.writeRisk === 'machine-critical') {
    return input.confirmation.typedCommand === command
      ? { kind: 'ok', command }
      : blocked(`Type ${command} exactly before writing machine-critical setting ${row.code}.`);
  }

  return blocked(`${row.code} is not writable by the guarded writer.`);
}

export function grblSettingMachineKindIssue(
  machineKind: MachineKind,
  id: number,
  value: string,
): string | null {
  const normalizedValue = value.trim();
  if (machineKind !== 'laser' || id !== 32 || normalizedValue === '') return null;
  // GRBL truncates the parsed float into an 8-bit integer before applying
  // $32. Values such as 0.5 therefore disable laser mode just like literal
  // zero, while oversized values can wrap. The confirmed Console lane accepts
  // a broader numeric grammar than Machine Settings, so laser projects allow
  // only the one canonical value whose firmware meaning is unambiguous.
  if (normalizedValue === '1') return null;
  return 'Laser machine setup cannot write $32=0 or a non-canonical $32 value. Only exact $32=1 is allowed for a laser; switch the project to CNC/router mode only for a spindle machine.';
}

export function grblSettingCommandMachineKindIssue(
  machineKind: MachineKind,
  command: string,
): string | null {
  const match = /^\$(\d+)\s*=\s*(.+)$/.exec(command.trim());
  const id = match?.[1];
  const value = match?.[2];
  if (id === undefined || value === undefined) return null;
  return grblSettingMachineKindIssue(machineKind, Number(id), value);
}

function isValidGrblSettingValue(id: number, value: string): boolean {
  if (value.length === 0) return false;
  if (!isCanonicalGrblDecimal(value)) return false;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return false;
  if (id === 32) return value === '0' || value === '1';
  if (id === 30) return parsed > 0;
  if (id === 31) return parsed >= 0;
  return parsed >= 0;
}

function isCanonicalGrblDecimal(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

function blocked(reason: string): BuildGrblSettingWriteResult {
  return { kind: 'blocked', reason };
}
