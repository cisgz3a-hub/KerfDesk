// Builds material-library documents from a device profile: a blank library for
// the current device, and a researched starter library for a catalogued machine
// (its presets generalised over the profile, never hardcoded to one machine).

import type { DeviceProfile } from '../../core/devices';
import {
  materialPresetWarnings,
  type MaterialRecipeOperation,
  type StarterMaterialPreset,
} from '../../core/material-library';
import {
  createMaterialLibraryDeviceHint,
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
  type MaterialPreset,
} from '../../io/material-library';

export function buildBlankLibrary(device: DeviceProfile): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: `laserforge-${slug(device.name)}`,
    name: `${device.name} Library`,
    deviceHint: createMaterialLibraryDeviceHint(device),
    entries: [],
  };
}

export function buildStarterLibrary(
  profile: DeviceProfile,
  presets: ReadonlyArray<StarterMaterialPreset>,
): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: `laserforge-${slug(profile.name)}-starter`,
    name: `${profile.name} Starter Library`,
    deviceHint: createMaterialLibraryDeviceHint(profile),
    entries: presets.map((preset) => toMaterialPreset(preset, profile)),
  };
}

function toMaterialPreset(preset: StarterMaterialPreset, profile: DeviceProfile): MaterialPreset {
  const warnings = materialPresetWarnings(preset);
  const warningText = warnings.length === 0 ? '' : ` Warnings: ${warnings.join(' ')}`;
  const unsupportedText = preset.unsupported === true ? ' Unsupported on this profile.' : '';
  return {
    id: preset.id,
    materialName: preset.materialName,
    material: preset.materialName,
    ...(preset.thicknessMm !== undefined ? { thicknessMm: preset.thicknessMm } : {}),
    ...(preset.title !== undefined ? { title: preset.title } : {}),
    ...starterPresetMetadata(preset, warnings, profile),
    description: `${preset.description}${unsupportedText}${warningText}`,
    recipe: preset.recipe,
    revision: preset.revision,
  };
}

function starterPresetMetadata(
  preset: StarterMaterialPreset,
  warnings: ReadonlyArray<string>,
  profile: DeviceProfile,
): Pick<
  MaterialPreset,
  | 'operation'
  | 'profileId'
  | 'machineFamily'
  | 'laserModel'
  | 'opticalPowerW'
  | 'confidence'
  | 'warning'
  | 'calibrationProvenance'
> {
  return {
    operation: starterPresetOperation(preset),
    ...(profile.profileId !== undefined ? { profileId: profile.profileId } : {}),
    ...(profile.machineFamily !== undefined ? { machineFamily: profile.machineFamily } : {}),
    ...(profile.laserSubProfile?.model !== undefined
      ? { laserModel: profile.laserSubProfile.model }
      : {}),
    ...(profile.laserSubProfile?.opticalPowerW !== undefined
      ? { opticalPowerW: profile.laserSubProfile.opticalPowerW }
      : {}),
    confidence: preset.unsupported === true ? 'unsupported' : 'starter',
    ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    calibrationProvenance: preset.revision,
  };
}

function starterPresetOperation(preset: StarterMaterialPreset): MaterialRecipeOperation {
  const text = `${preset.id} ${preset.description} ${preset.title ?? ''}`.toLowerCase();
  if (text.includes('cut')) return 'cut';
  if (preset.recipe.mode === 'image') return 'engrave';
  return 'engrave';
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'library'
  );
}
