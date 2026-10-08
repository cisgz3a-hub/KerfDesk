import type { CncLayerSettings, CncTool } from '../scene';
import type { CncCuttingStage, CncStageRecipe } from '../scene/cnc-stage-recipe';

export function cncStageRecipe(
  settings: CncLayerSettings,
  stage: CncCuttingStage,
  tool: CncTool,
): CncStageRecipe | undefined {
  const recipe = settings.stageRecipes?.[stage];
  return recipe?.toolId === tool.id ? recipe : undefined;
}

/** Manual stage values never borrow the primary cutter's automatic-feed provenance. */
export function cncSettingsForStage(
  settings: CncLayerSettings,
  stage: CncCuttingStage,
  tool: CncTool,
): CncLayerSettings {
  const recipe = cncStageRecipe(settings, stage, tool);
  if (recipe === undefined) return settings;
  const { feedSource: _source, cuttingPreset: _primaryPreset, ...manual } = settings;
  return {
    ...manual,
    ...(recipe.cuttingPreset === undefined ? {} : { cuttingPreset: recipe.cuttingPreset }),
    feedMmPerMin: recipe.feedMmPerMin,
    plungeMmPerMin: recipe.plungeMmPerMin,
    spindleRpm: recipe.spindleRpm,
    depthPerPassMm: recipe.depthPerPassMm,
  };
}

export function cncStageProvenance(
  settings: CncLayerSettings,
  stage: CncCuttingStage,
  tool: CncTool,
): { readonly cuttingStage?: CncCuttingStage } {
  return cncStageRecipe(settings, stage, tool) === undefined ? {} : { cuttingStage: stage };
}
