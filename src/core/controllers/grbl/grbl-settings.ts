import {
  GRBL_SETTING_DEFINITIONS,
  type GrblSettingCategory,
  type GrblSettingWriteRisk,
} from './grbl-setting-definitions';

export type { GrblSettingCategory, GrblSettingWriteRisk } from './grbl-setting-definitions';

export type GrblSettingRow = {
  readonly id: number;
  readonly code: `$${number}`;
  readonly rawValue: string;
  readonly numericValue: number | null;
  readonly name: string;
  readonly unit: string | null;
  readonly description: string;
  readonly category: GrblSettingCategory;
  readonly known: boolean;
  readonly writeRisk: GrblSettingWriteRisk;
};

export type GrblSettingsBackup = {
  readonly format: 'laserforge.grbl-settings.backup';
  readonly version: 1;
  readonly createdAt: string;
  readonly settings: ReadonlyArray<GrblSettingRow>;
};

export function settingsMapToRows(map: ReadonlyMap<number, string>): ReadonlyArray<GrblSettingRow> {
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([id, rawValue]) => {
      const definition = GRBL_SETTING_DEFINITIONS.get(id);
      const code = `$${id}` as `$${number}`;
      const numericValue = parseFiniteNumber(rawValue);
      if (definition === undefined) {
        return {
          id,
          code,
          rawValue,
          numericValue,
          name: 'Unknown GRBL setting',
          unit: null,
          description:
            'This setting is reported by the controller but is not in KerfDesk metadata.',
          category: 'unknown',
          known: false,
          writeRisk: 'unknown',
        };
      }
      return {
        id,
        code,
        rawValue,
        numericValue,
        ...definition,
        known: true,
      };
    });
}

export function createGrblSettingsBackup(
  rows: ReadonlyArray<GrblSettingRow>,
  createdAt: string,
): GrblSettingsBackup {
  return {
    format: 'laserforge.grbl-settings.backup',
    version: 1,
    createdAt,
    settings: rows,
  };
}

function parseFiniteNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
