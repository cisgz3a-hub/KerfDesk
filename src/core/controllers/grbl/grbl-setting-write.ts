import type { GrblSettingRow } from './grbl-settings';

export type GrblSettingWriteConfirmation = {
  readonly commonSettingChecked?: boolean;
  readonly typedCommand?: string;
};

export type BuildGrblSettingWriteInput = {
  readonly rows: ReadonlyArray<GrblSettingRow>;
  readonly id: number;
  readonly value: string;
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
