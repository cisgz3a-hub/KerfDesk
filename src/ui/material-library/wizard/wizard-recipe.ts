// Bridges the wizard draft to the shared recipe model and the .lfml preset
// document (ADR-093). A throwaway Layer lets the wizard reuse the exact layer
// cut-settings field components and their FormData reader, so a preset is edited
// with the same controls — and the same numeric clamping — as a layer.

import {
  applyMaterialRecipe,
  captureMaterialRecipe,
  materialRecipePatch,
  type MaterialRecipe,
  type MaterialRecipeOperation,
} from '../../../core/material-library';
import { createLayer, type Layer, type LayerMode } from '../../../core/scene';
import type { MaterialPreset } from '../../../io/material-library';
import { readCutSettingsPatch } from '../../layers/cut-settings-draft';
import type { IdentityDraft } from './wizard-state';

// Off-canvas throwaway layer: its color is never rendered, it only satisfies
// Layer.color so the recipe can drive the shared cut-settings field components.
// eslint-disable-next-line no-restricted-syntax -- not chrome; a non-rendered placeholder color
const DRAFT_LAYER = { id: 'material-preset-draft', color: '#000000' } as const;

export function defaultRecipe(): MaterialRecipe {
  return captureMaterialRecipe(createLayer(DRAFT_LAYER));
}

export function recipeToLayer(recipe: MaterialRecipe): Layer {
  return applyMaterialRecipe(createLayer(DRAFT_LAYER), recipe);
}

// Reads the current step's form into the recipe, falling back to the existing
// recipe for fields not on that step (identity/settings/details are separate
// renders, so each form only carries its own controls).
export function readRecipeFromForm(form: HTMLFormElement, recipe: MaterialRecipe): MaterialRecipe {
  const layer = recipeToLayer(recipe);
  return captureMaterialRecipe({ ...layer, ...readCutSettingsPatch(new FormData(form), layer) });
}

export function identityFromPreset(preset: MaterialPreset): IdentityDraft {
  const mm = preset.thicknessMm;
  return {
    materialName: preset.materialName,
    thicknessMode: mm !== undefined ? 'thickness' : 'surface',
    thicknessMm: mm !== undefined ? formatThickness(mm) : '',
    title: preset.title ?? '',
    description: preset.description,
  };
}

export function buildPreset(args: {
  readonly identity: IdentityDraft;
  readonly recipe: MaterialRecipe;
  readonly existing: MaterialPreset | null;
  readonly id: string;
  readonly revision: string;
}): MaterialPreset {
  const name = args.identity.materialName.trim();
  return {
    ...preservedMetadata(args.existing),
    id: args.id,
    materialName: name,
    material: name,
    ...thicknessOrTitle(args.identity),
    operation: args.existing?.operation ?? defaultOperation(args.recipe.mode),
    description: args.identity.description.trim(),
    recipe: materialRecipePatch(args.recipe),
    revision: args.revision,
  };
}

// Derives a stable, unique preset id from the material + thickness/title,
// suffixing on collision so two presets never share an id within a library.
export function nextPresetId(identity: IdentityDraft, existingIds: ReadonlySet<string>): string {
  const label =
    identity.thicknessMode === 'thickness' ? `${identity.thicknessMm.trim()}mm` : identity.title;
  const base = slug(`${identity.materialName}-${label}`);
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function thicknessOrTitle(
  identity: IdentityDraft,
): { readonly thicknessMm: number } | { readonly title: string } {
  if (identity.thicknessMode === 'thickness') return { thicknessMm: Number(identity.thicknessMm) };
  return { title: identity.title.trim() };
}

function defaultOperation(mode: LayerMode): MaterialRecipeOperation {
  return mode === 'line' ? 'cut' : 'engrave';
}

// Carries provenance forward when editing (calibration source, device, etc.);
// material and operation are re-derived above, so they are excluded here.
function preservedMetadata(existing: MaterialPreset | null): Partial<MaterialPreset> {
  if (existing === null) return {};
  return {
    ...(existing.profileId !== undefined ? { profileId: existing.profileId } : {}),
    ...(existing.machineFamily !== undefined ? { machineFamily: existing.machineFamily } : {}),
    ...(existing.laserModel !== undefined ? { laserModel: existing.laserModel } : {}),
    ...(existing.opticalPowerW !== undefined ? { opticalPowerW: existing.opticalPowerW } : {}),
    ...(existing.confidence !== undefined ? { confidence: existing.confidence } : {}),
    ...(existing.warning !== undefined ? { warning: existing.warning } : {}),
    ...(existing.calibrationProvenance !== undefined
      ? { calibrationProvenance: existing.calibrationProvenance }
      : {}),
  };
}

function formatThickness(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'preset'
  );
}
