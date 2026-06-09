import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';

export type ImagePresetSettings = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly ditherAlgorithm: Layer['ditherAlgorithm'];
  readonly minPower: number;
  readonly linesPerMm: number;
  readonly dotWidthCorrectionMm: number;
  readonly negativeImage: boolean;
  readonly passThrough: boolean;
  readonly invertDisplay: boolean;
};

export type UserImagePreset = {
  readonly name: string;
  readonly settings: ImagePresetSettings;
  readonly updatedAt: number;
};

export type SaveUserImagePresetResult =
  | {
      readonly kind: 'ok';
      readonly preset: UserImagePreset;
      readonly presets: readonly UserImagePreset[];
    }
  | { readonly kind: 'invalid-name' }
  | { readonly kind: 'reserved-name' };

export type UserImagePresetWriteResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly error: unknown };

export const IMAGE_PRESETS_KEY = 'lf2:image-presets:v1';
const IMAGE_PRESETS_SCHEMA_VERSION = 1;
const RESERVED_PRESET_NAMES = new Set(['custom', 'basic', 'black paint on white']);

type UserImagePresetRecord = {
  readonly schemaVersion: number;
  readonly presets: readonly UserImagePreset[];
};

export function readUserImagePresets(): readonly UserImagePreset[] {
  if (typeof localStorage === 'undefined') return [];
  let raw: string | null;
  try {
    raw = localStorage.getItem(IMAGE_PRESETS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isUserImagePresetRecord(parsed)) return [];
  if (parsed.schemaVersion !== IMAGE_PRESETS_SCHEMA_VERSION) return [];
  return sortPresets(parsed.presets.filter(isUserImagePreset));
}

export function writeUserImagePresets(
  presets: readonly UserImagePreset[],
): UserImagePresetWriteResult {
  if (typeof localStorage === 'undefined') return { kind: 'unavailable' };
  try {
    const record: UserImagePresetRecord = {
      schemaVersion: IMAGE_PRESETS_SCHEMA_VERSION,
      presets: sortPresets(presets),
    };
    localStorage.setItem(IMAGE_PRESETS_KEY, JSON.stringify(record));
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

export function saveUserImagePreset(
  presets: readonly UserImagePreset[],
  name: string,
  settings: ImagePresetSettings,
  now: number = Date.now(),
): SaveUserImagePresetResult {
  const normalizedName = normalizePresetName(name);
  if (normalizedName === null) return { kind: 'invalid-name' };
  if (RESERVED_PRESET_NAMES.has(normalizedName.toLocaleLowerCase())) {
    return { kind: 'reserved-name' };
  }
  const preset: UserImagePreset = { name: normalizedName, settings, updatedAt: now };
  const presetsWithoutOld = presets.filter(
    (candidate) => candidate.name.toLocaleLowerCase() !== normalizedName.toLocaleLowerCase(),
  );
  return { kind: 'ok', preset, presets: sortPresets([...presetsWithoutOld, preset]) };
}

export function deleteUserImagePreset(
  presets: readonly UserImagePreset[],
  name: string,
): readonly UserImagePreset[] {
  return sortPresets(
    presets.filter((candidate) => candidate.name.toLocaleLowerCase() !== name.toLocaleLowerCase()),
  );
}

export function userImagePresetId(name: string): `user:${string}` {
  return `user:${name}`;
}

export function userImagePresetNameFromId(id: string): string | null {
  return id.startsWith('user:') ? id.slice('user:'.length) : null;
}

export function findUserImagePreset(
  presets: readonly UserImagePreset[],
  id: string,
): UserImagePreset | null {
  const name = userImagePresetNameFromId(id);
  if (name === null) return null;
  return (
    presets.find((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ??
    null
  );
}

function normalizePresetName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed.length === 0 ? null : trimmed;
}

function sortPresets(presets: readonly UserImagePreset[]): readonly UserImagePreset[] {
  return [...presets].sort((a, b) => a.name.localeCompare(b.name));
}

function isUserImagePresetRecord(v: unknown): v is UserImagePresetRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r['presets']) && typeof r['schemaVersion'] === 'number';
}

function isUserImagePreset(v: unknown): v is UserImagePreset {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['name'] === 'string' &&
    typeof r['updatedAt'] === 'number' &&
    isImagePresetSettings(r['settings'])
  );
}

function isImagePresetSettings(v: unknown): v is ImagePresetSettings {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['brightness'] === 'number' &&
    typeof r['contrast'] === 'number' &&
    typeof r['gamma'] === 'number' &&
    isDitherAlgorithm(r['ditherAlgorithm']) &&
    typeof r['minPower'] === 'number' &&
    typeof r['linesPerMm'] === 'number' &&
    typeof r['dotWidthCorrectionMm'] === 'number' &&
    typeof r['negativeImage'] === 'boolean' &&
    typeof r['passThrough'] === 'boolean' &&
    typeof r['invertDisplay'] === 'boolean'
  );
}

function isDitherAlgorithm(value: unknown): value is Layer['ditherAlgorithm'] {
  return typeof value === 'string' && DITHER_ALGORITHMS.some((algorithm) => algorithm === value);
}
