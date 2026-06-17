export type { MaterialRecipe } from './material-library';
export {
  applyMaterialRecipe,
  captureMaterialRecipe,
  isMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
  normalizeMaterialRecipe,
} from './material-library';
export type {
  MaterialRecipeCandidate,
  MaterialRecipeConfidence,
  MaterialRecipeMatch,
  MaterialRecipeMatchQuery,
  MaterialRecipeMatchScope,
  MaterialRecipeOperation,
} from './material-matching';
export { rankMaterialRecipeCandidates, recipeConfidence } from './material-matching';
export {
  isUnsupportedPreset,
  materialPresetWarnings,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS,
  type StarterMaterialPreset,
} from './neotronics-4040-presets';
