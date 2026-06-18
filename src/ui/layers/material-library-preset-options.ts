import type { DeviceProfile } from '../../core/devices';
import {
  rankMaterialRecipeCandidates,
  type MaterialRecipeMatch,
  type MaterialRecipeMatchScope,
} from '../../core/material-library';
import type { MaterialPreset } from '../../io/material-library';

const INCOMPATIBLE_WARNING = 'Preset is not compatible with the active device profile.';

export type MaterialLibraryPresetOption = {
  readonly preset: MaterialPreset;
  readonly label: string;
  readonly statusText: string;
  readonly warnings: ReadonlyArray<string>;
  readonly isAssignable: boolean;
};

export function materialLibraryPresetOptions(
  device: DeviceProfile,
  presets: ReadonlyArray<MaterialPreset>,
): ReadonlyArray<MaterialLibraryPresetOption> {
  const ranked = rankMaterialRecipeCandidates(device, presets);
  const matchedIds = new Set(ranked.map((match) => match.candidate.id));
  const unmatched = presets
    .filter((preset) => !matchedIds.has(preset.id))
    .map((preset) => unmatchedOption(preset));
  return [...ranked.map(matchedOption), ...unmatched];
}

function matchedOption(
  match: MaterialRecipeMatch<MaterialPreset>,
): MaterialLibraryPresetOption {
  const statusText = `${match.confidence} / ${scopeLabel(match.scope)}`;
  return {
    preset: match.candidate,
    label: `${presetLabel(match.candidate)} - ${statusText}`,
    statusText,
    warnings: match.warnings,
    isAssignable: match.confidence !== 'unsupported',
  };
}

function unmatchedOption(preset: MaterialPreset): MaterialLibraryPresetOption {
  return {
    preset,
    label: `${presetLabel(preset)} - not compatible`,
    statusText: 'not compatible',
    warnings: [INCOMPATIBLE_WARNING],
    isAssignable: false,
  };
}

function presetLabel(preset: MaterialPreset): string {
  const label =
    preset.thicknessMm !== undefined ? `${formatThickness(preset.thicknessMm)} mm` : preset.title;
  return `${preset.materialName} - ${label ?? 'Preset'}`;
}

function scopeLabel(scope: MaterialRecipeMatchScope): string {
  return scope.replaceAll('-', ' ');
}

function formatThickness(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
