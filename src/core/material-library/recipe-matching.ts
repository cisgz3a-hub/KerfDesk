import type { DeviceProfile } from '../devices';
import type { MaterialRecipe } from './material-library';

export type RecipeConfidence = 'starter' | 'calibrated' | 'imported' | 'unsupported';
export type RecipeMatchLevel =
  | 'exact-profile'
  | 'machine-family'
  | 'optical-power'
  | 'generic'
  | 'unsupported';

export type MaterialOperation = 'cut' | 'engrave' | 'score' | 'mark' | string;

export type MaterialRecipeCandidate = {
  readonly id: string;
  readonly materialName: string;
  readonly thicknessMm?: number;
  readonly operation?: MaterialOperation;
  readonly recipe: MaterialRecipe;
  readonly confidence: RecipeConfidence;
  readonly profileId?: string;
  readonly machineFamily?: string;
  readonly laserModel?: string;
  readonly opticalPowerW?: number;
};

export type RankedMaterialRecipe = {
  readonly recipe: MaterialRecipeCandidate;
  readonly matchLevel: RecipeMatchLevel;
  readonly score: number;
  readonly warning?: string;
};

export function rankMaterialRecipesForProfile(
  profile: DeviceProfile,
  recipes: ReadonlyArray<MaterialRecipeCandidate>,
): ReadonlyArray<RankedMaterialRecipe> {
  return recipes
    .map((recipe) => rankRecipe(profile, recipe))
    .sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));
}

function rankRecipe(profile: DeviceProfile, recipe: MaterialRecipeCandidate): RankedMaterialRecipe {
  const unsupported = unsupportedReason(profile, recipe);
  if (unsupported !== null) {
    return {
      recipe,
      matchLevel: 'unsupported',
      score: -1,
      warning: unsupported,
    };
  }
  if (recipe.profileId !== undefined && recipe.profileId === profile.profileId) {
    return { recipe, matchLevel: 'exact-profile', score: 400 };
  }
  if (recipe.machineFamily !== undefined && recipe.machineFamily === profile.machineFamily) {
    return { recipe, matchLevel: 'machine-family', score: 300 };
  }
  if (
    recipe.opticalPowerW !== undefined &&
    recipe.opticalPowerW === profile.laserSubProfile?.opticalPowerW
  ) {
    return { recipe, matchLevel: 'optical-power', score: 200 };
  }
  return { recipe, matchLevel: 'generic', score: 100 };
}

function unsupportedReason(profile: DeviceProfile, recipe: MaterialRecipeCandidate): string | null {
  if (recipe.profileId !== undefined && recipe.profileId !== profile.profileId) {
    return `Recipe is calibrated for profile ${recipe.profileId}, not ${profile.profileId ?? profile.name}.`;
  }
  if (recipe.machineFamily !== undefined && recipe.machineFamily !== profile.machineFamily) {
    return `Recipe is for machine family ${recipe.machineFamily}, not ${profile.machineFamily ?? profile.name}.`;
  }
  if (
    recipe.opticalPowerW !== undefined &&
    recipe.opticalPowerW !== profile.laserSubProfile?.opticalPowerW
  ) {
    return `Recipe expects ${recipe.opticalPowerW}W optical power; current profile is ${profile.laserSubProfile?.opticalPowerW ?? 'unknown'}W.`;
  }
  return null;
}
