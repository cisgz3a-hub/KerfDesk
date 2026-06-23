import {
  isMaterialRecipe,
  normalizeMaterialRecipe,
  type MaterialRecipe,
  type MaterialRecipeConfidence,
  type MaterialRecipeOperation,
} from '../../core/material-library';
import {
  canonicalDeviceHint,
  createMaterialLibraryDeviceHint,
  parseOptionalDeviceHint,
  type MaterialLibraryDeviceHint,
} from './material-library-device-hint';
import { parsePresetMatchMetadata } from './material-preset-metadata';

export const MATERIAL_LIBRARY_FORMAT = 'laserforge-material-library';
export const MATERIAL_LIBRARY_SCHEMA_VERSION = 1;

export { createMaterialLibraryDeviceHint };
export type { MaterialLibraryDeviceHint };

export type MaterialPreset = {
  readonly id: string;
  readonly materialName: string;
  readonly material?: string;
  readonly thicknessMm?: number;
  readonly title?: string;
  readonly operation?: MaterialRecipeOperation;
  readonly profileId?: string;
  readonly machineFamily?: string;
  readonly laserModel?: string;
  readonly opticalPowerW?: number;
  readonly confidence?: MaterialRecipeConfidence;
  readonly warning?: string;
  readonly calibrationProvenance?: string;
  readonly description: string;
  readonly recipe: MaterialRecipe;
  readonly revision: string;
};

export type MaterialLibraryDocument = {
  readonly format: typeof MATERIAL_LIBRARY_FORMAT;
  readonly librarySchemaVersion: typeof MATERIAL_LIBRARY_SCHEMA_VERSION;
  readonly libraryId: string;
  readonly name: string;
  readonly deviceHint?: MaterialLibraryDeviceHint;
  readonly entries: ReadonlyArray<MaterialPreset>;
};

export type DeserializeMaterialLibraryResult =
  | { readonly kind: 'ok'; readonly library: MaterialLibraryDocument }
  | { readonly kind: 'schema-too-new'; readonly sawVersion: number }
  | { readonly kind: 'schema-too-old'; readonly sawVersion: number }
  | { readonly kind: 'invalid'; readonly reason: string };

export type MergeMaterialLibrariesResult = {
  readonly library: MaterialLibraryDocument;
  readonly skippedDuplicateIds: ReadonlyArray<string>;
};

export function serializeMaterialLibrary(document: MaterialLibraryDocument): string {
  return `${JSON.stringify(canonicalLibrary(document), null, 2)}\n`;
}

export function deserializeMaterialLibrary(jsonText: string): DeserializeMaterialLibraryResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'invalid', reason: `not valid JSON: ${message}` };
  }

  if (!isRecord(raw)) {
    return { kind: 'invalid', reason: 'top-level value is not an object' };
  }

  const format = raw['format'];
  if (format !== MATERIAL_LIBRARY_FORMAT) {
    return { kind: 'invalid', reason: 'wrong material library format' };
  }

  const version = raw['librarySchemaVersion'];
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { kind: 'invalid', reason: 'missing or non-numeric librarySchemaVersion' };
  }
  if (version > MATERIAL_LIBRARY_SCHEMA_VERSION) {
    return { kind: 'schema-too-new', sawVersion: version };
  }
  if (version < MATERIAL_LIBRARY_SCHEMA_VERSION) {
    return { kind: 'schema-too-old', sawVersion: version };
  }

  return parseCurrentLibrary(raw);
}

export function mergeMaterialLibraries(
  base: MaterialLibraryDocument,
  incoming: MaterialLibraryDocument,
): MergeMaterialLibrariesResult {
  const seenIds = new Set(base.entries.map((entry) => entry.id));
  const skippedDuplicateIds: string[] = [];
  const appended: MaterialPreset[] = [];

  for (const entry of incoming.entries) {
    if (seenIds.has(entry.id)) {
      skippedDuplicateIds.push(entry.id);
      continue;
    }
    seenIds.add(entry.id);
    appended.push(entry);
  }

  return {
    library: canonicalLibrary({ ...base, entries: [...base.entries, ...appended] }),
    skippedDuplicateIds,
  };
}

function parseCurrentLibrary(raw: Record<string, unknown>): DeserializeMaterialLibraryResult {
  const libraryId = raw['libraryId'];
  const name = raw['name'];
  const entries = raw['entries'];

  if (!isNonEmptyString(libraryId)) {
    return { kind: 'invalid', reason: 'libraryId must be a non-empty string' };
  }
  if (!isNonEmptyString(name)) {
    return { kind: 'invalid', reason: 'name must be a non-empty string' };
  }
  if (!Array.isArray(entries)) {
    return { kind: 'invalid', reason: 'entries must be an array' };
  }

  const deviceHintResult = parseOptionalDeviceHint(raw['deviceHint']);
  if (deviceHintResult.kind === 'invalid') {
    return deviceHintResult;
  }

  const entryResult = parseEntries(entries);
  if (entryResult.kind === 'invalid') {
    return entryResult;
  }

  return {
    kind: 'ok',
    library: canonicalLibrary({
      format: MATERIAL_LIBRARY_FORMAT,
      librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
      libraryId,
      name,
      ...(deviceHintResult.deviceHint !== undefined
        ? { deviceHint: deviceHintResult.deviceHint }
        : {}),
      entries: entryResult.entries,
    }),
  };
}

function parseEntries(
  values: ReadonlyArray<unknown>,
):
  | { readonly kind: 'ok'; readonly entries: ReadonlyArray<MaterialPreset> }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const seenIds = new Set<string>();
  const entries: MaterialPreset[] = [];

  for (const [index, value] of values.entries()) {
    const preset = parsePreset(value, index);
    if (preset.kind === 'invalid') {
      return preset;
    }
    if (seenIds.has(preset.entry.id)) {
      return { kind: 'invalid', reason: `duplicate preset id: ${preset.entry.id}` };
    }
    seenIds.add(preset.entry.id);
    entries.push(preset.entry);
  }

  return { kind: 'ok', entries };
}

function parsePreset(
  value: unknown,
  index: number,
):
  | { readonly kind: 'ok'; readonly entry: MaterialPreset }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!isRecord(value)) {
    return { kind: 'invalid', reason: `entries[${index}] must be an object` };
  }

  const strings = parsePresetStrings(value, index);
  if (strings.kind === 'invalid') {
    return strings;
  }
  const thickness = parseThicknessTitle(value, index);
  if (thickness.kind === 'invalid') {
    return thickness;
  }
  if (!isMaterialRecipe(value['recipe'])) {
    return { kind: 'invalid', reason: `entries[${index}].recipe is invalid` };
  }
  const matchMetadata = parsePresetMatchMetadata(value, index);
  if (matchMetadata.kind === 'invalid') return matchMetadata;

  return {
    kind: 'ok',
    entry: canonicalPreset({
      id: strings.id,
      materialName: strings.materialName,
      ...matchMetadata.metadata,
      ...(thickness.thicknessMm !== undefined ? { thicknessMm: thickness.thicknessMm } : {}),
      ...(thickness.title !== undefined ? { title: thickness.title } : {}),
      description: strings.description,
      recipe: normalizeMaterialRecipe(value['recipe']),
      revision: strings.revision,
    }),
  };
}

function parsePresetStrings(
  value: Record<string, unknown>,
  index: number,
):
  | {
      readonly kind: 'ok';
      readonly id: string;
      readonly materialName: string;
      readonly description: string;
      readonly revision: string;
    }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const id = value['id'];
  const materialName = value['materialName'];
  const description = value['description'];
  const revision = value['revision'];

  if (!isNonEmptyString(id)) return invalidField(index, 'id');
  if (!isNonEmptyString(materialName)) return invalidField(index, 'materialName');
  if (!isNonEmptyString(description)) return invalidField(index, 'description');
  if (!isNonEmptyString(revision)) return invalidField(index, 'revision');

  return { kind: 'ok', id, materialName, description, revision };
}

function parseThicknessTitle(
  value: Record<string, unknown>,
  index: number,
):
  | { readonly kind: 'ok'; readonly thicknessMm?: number; readonly title?: string }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const thicknessMm = value['thicknessMm'];
  const title = value['title'];
  const hasThickness = thicknessMm !== undefined;
  const hasTitle = title !== undefined;

  if (hasThickness === hasTitle) {
    return {
      kind: 'invalid',
      reason: `entries[${index}] must provide exactly one of thicknessMm or title`,
    };
  }
  if (hasThickness) {
    return parseThickness(thicknessMm, index);
  }
  if (isNonEmptyString(title)) {
    return { kind: 'ok', title };
  }
  return { kind: 'invalid', reason: `entries[${index}].title must be a non-empty string` };
}

function parseThickness(
  value: unknown,
  index: number,
):
  | { readonly kind: 'ok'; readonly thicknessMm: number }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { kind: 'ok', thicknessMm: value };
  }
  return { kind: 'invalid', reason: `entries[${index}].thicknessMm must be positive` };
}

function canonicalLibrary(document: MaterialLibraryDocument): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: document.libraryId,
    name: document.name,
    ...(document.deviceHint !== undefined
      ? { deviceHint: canonicalDeviceHint(document.deviceHint) }
      : {}),
    entries: document.entries.map(canonicalPreset),
  };
}

function canonicalPreset(preset: MaterialPreset): MaterialPreset {
  return {
    id: preset.id,
    materialName: preset.materialName,
    ...(preset.material !== undefined ? { material: preset.material } : {}),
    ...(preset.thicknessMm !== undefined ? { thicknessMm: preset.thicknessMm } : {}),
    ...(preset.title !== undefined ? { title: preset.title } : {}),
    ...(preset.operation !== undefined ? { operation: preset.operation } : {}),
    ...(preset.profileId !== undefined ? { profileId: preset.profileId } : {}),
    ...(preset.machineFamily !== undefined ? { machineFamily: preset.machineFamily } : {}),
    ...(preset.laserModel !== undefined ? { laserModel: preset.laserModel } : {}),
    ...(preset.opticalPowerW !== undefined ? { opticalPowerW: preset.opticalPowerW } : {}),
    ...(preset.confidence !== undefined ? { confidence: preset.confidence } : {}),
    ...(preset.warning !== undefined ? { warning: preset.warning } : {}),
    ...(preset.calibrationProvenance !== undefined
      ? { calibrationProvenance: preset.calibrationProvenance }
      : {}),
    description: preset.description,
    recipe: normalizeMaterialRecipe(preset.recipe),
    revision: preset.revision,
  };
}

function invalidField(
  index: number,
  field: string,
): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason: `entries[${index}].${field} must be a non-empty string` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
