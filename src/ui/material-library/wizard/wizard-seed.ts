// Prefills for the material preset wizard (ADR-381): a tuned operation, a
// burned Material Test cell, or an existing preset to duplicate. ADR-093 keeps
// prefill optional — the operator still names the material and thickness and
// walks every step, and nothing is saved before the final Save.

import type { DeviceProfile } from '../../../core/devices';
import { captureMaterialRecipe, type MaterialRecipe } from '../../../core/material-library';
import type { Layer, LayerOperationSettings } from '../../../core/scene';
import type { MaterialPreset } from '../../../io/material-library';
import {
  defaultRecipe,
  identityFromPreset,
  preservedPresetMetadata,
  recipeToLayer,
} from './wizard-recipe';
import { EMPTY_IDENTITY, type IdentityDraft } from './wizard-state';

export type PresetSeedMetadata = Partial<
  Pick<
    MaterialPreset,
    | 'operation'
    | 'profileId'
    | 'machineFamily'
    | 'laserModel'
    | 'laserTechnology'
    | 'opticalPowerW'
    | 'wavelengthNm'
    | 'confidence'
    | 'warning'
    | 'calibrationProvenance'
  >
>;

export type MaterialPresetWizardSeed = {
  /** One line telling the operator where the settings came from. */
  readonly source: string;
  readonly identity: IdentityDraft;
  readonly recipe: MaterialRecipe;
  readonly metadata?: PresetSeedMetadata;
};

/** Every captured setting of an operation (with the artwork's own overrides). */
export function seedFromOperation(operation: Layer): MaterialPresetWizardSeed {
  const recipe = captureMaterialRecipe(operation);
  const name = operation.name.trim();
  // LightBurn's "Create new from layer" keeps sub-layers; a material preset
  // here holds one recipe, so say what stays behind.
  const subLayers =
    operation.subLayers.length === 0 ? '' : ' Sub-layers are not part of a material preset.';
  return {
    source: `Settings copied from ${name === '' ? 'the operation' : name}. Name the material and thickness they suit.${subLayers}`,
    identity: { ...EMPTY_IDENTITY, description: name === '' ? recipeSummary(recipe) : name },
    recipe,
  };
}

export function seedFromPreset(preset: MaterialPreset): MaterialPresetWizardSeed {
  const identity = identityFromPreset(preset);
  return {
    source: `Copy of ${preset.materialName} — ${preset.description}. Saving adds a new preset.`,
    identity: { ...identity, description: `${identity.description} (copy)` },
    recipe: preset.recipe,
    metadata: {
      ...preservedPresetMetadata(preset),
      ...(preset.operation === undefined ? {} : { operation: preset.operation }),
    },
  };
}

/** A burned Material Test cell: its settings plus where they were calibrated. */
export function seedFromTestCell(args: {
  readonly settings: LayerOperationSettings;
  readonly cellLabel: string;
  readonly device: DeviceProfile;
  readonly date: string;
}): MaterialPresetWizardSeed {
  const recipe = captureMaterialRecipe({ ...recipeToLayer(defaultRecipe()), ...args.settings });
  const summary = recipeSummary(recipe);
  return {
    source: `Settings from ${args.cellLabel}. Name the material and thickness you tested.`,
    identity: { ...EMPTY_IDENTITY, description: summary },
    recipe,
    metadata: {
      ...deviceMetadata(args.device),
      confidence: 'calibrated',
      calibrationProvenance: `${args.cellLabel} (${summary}) on ${args.device.name}, ${args.date}`,
    },
  };
}

export function recipeSummary(recipe: MaterialRecipe): string {
  const parts = [modeName(recipe.mode), `${formatValue(recipe.power)}%`];
  parts.push(`${formatValue(recipe.speed)} mm/min`);
  if (recipe.passes > 1) parts.push(`${recipe.passes} passes`);
  if (recipe.mode === 'fill') parts.push(`${formatValue(recipe.hatchSpacingMm)} mm interval`);
  if (recipe.mode === 'image') parts.push(`${formatValue(1 / recipe.linesPerMm)} mm interval`);
  return parts.join(' · ');
}

function deviceMetadata(device: DeviceProfile): PresetSeedMetadata {
  const head = device.laserSubProfile;
  return {
    ...(device.profileId === undefined ? {} : { profileId: device.profileId }),
    ...(device.machineFamily === undefined ? {} : { machineFamily: device.machineFamily }),
    ...(head?.model === undefined ? {} : { laserModel: head.model }),
    ...(head?.technology === undefined ? {} : { laserTechnology: head.technology }),
    ...(head?.opticalPowerW === undefined ? {} : { opticalPowerW: head.opticalPowerW }),
    ...(head?.wavelengthNm === undefined ? {} : { wavelengthNm: head.wavelengthNm }),
  };
}

function modeName(mode: MaterialRecipe['mode']): string {
  if (mode === 'line') return 'Line';
  if (mode === 'fill') return 'Fill';
  return 'Image';
}

function formatValue(value: number): string {
  return String(Number(value.toFixed(3)));
}
