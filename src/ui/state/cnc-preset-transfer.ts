import type { CncCuttingPreset } from '../../core/scene/cnc-cutting-preset';
import { normalizeCncCuttingPreset } from '../../core/cnc/cutting-preset-normalize';

export type CncPresetImportPreview = {
  readonly presets: ReadonlyArray<CncCuttingPreset>;
  readonly discarded: number;
  readonly conflicts: ReadonlyArray<string>;
  readonly error: string | null;
};

/** A preview only: IDs are replaced by the library action on deliberate import. */
export function previewCncPresetImport(
  json: string,
  existing: ReadonlyArray<CncCuttingPreset>,
): CncPresetImportPreview {
  const empty = { presets: [], discarded: 0, conflicts: [] };
  if (json.length > 2_000_000)
    return { ...empty, error: 'Preset JSON exceeds the 2 MB import limit.' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...empty, error: 'Enter valid preset JSON.' };
  }
  const records = importRecords(raw);
  if (records === null)
    return {
      ...empty,
      error:
        'Unsupported preset format or units. Use a record, array or exported feedPresets document.',
    };
  if (records.length > 256)
    return { ...empty, error: 'Import at most 256 cutting records at a time.' };
  const presets = records.flatMap((record) => {
    const parsed = normalizeCncCuttingPreset(record);
    return parsed === null ? [] : [parsed];
  });
  const conflicts = presets
    .filter((preset) =>
      existing.some((saved) => saved.id === preset.id || saved.name === preset.name),
    )
    .map(
      (preset) => `${preset.name}: an existing ID or name matches; import creates a separate copy.`,
    );
  return {
    presets,
    discarded: records.length - presets.length,
    conflicts,
    error: presets.length === 0 ? 'No valid cutting records were found.' : null,
  };
}

function importRecords(raw: unknown): ReadonlyArray<unknown> | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record['schemaVersion'] !== undefined && record['schemaVersion'] !== 1) return null;
  if (record['units'] !== undefined && record['units'] !== 'mm-min-rpm') return null;
  return Array.isArray(record['feedPresets']) ? record['feedPresets'] : [raw];
}
