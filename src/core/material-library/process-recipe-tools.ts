import { type CncLayerSettings, type CncMachineConfig, type CncTool, layerCncTool } from '../scene';
import { CNC_CUTTING_STAGES } from '../scene/cnc-stage-recipe';
import { cloneRecipeCnc, type ProcessRecipe } from './process-recipe';

export const RECIPE_TOOL_FIELDS = [
  'toolId',
  'vClearToolId',
  'pocketRoughToolId',
  'reliefFinishToolId',
] as const;

export function captureRecipeCnc(
  settings: CncLayerSettings,
  machine: CncMachineConfig,
): CncLayerSettings {
  return { ...cloneRecipeCnc(settings), toolId: layerCncTool(machine, settings).id };
}

/** Existing cutters are never overwritten, even when an imported ID collides. */
export function installRecipeTools(
  machine: CncMachineConfig,
  recipe: ProcessRecipe,
): {
  readonly machine: CncMachineConfig;
  readonly ids: ReadonlyMap<string, string>;
} {
  const tools = [...machine.tools];
  const ids = new Map<string, string>();
  for (const tool of recipe.tools ?? []) {
    const existing = tools.find((candidate) => sameTool(candidate, tool));
    const id = existing?.id ?? freeToolId(tools, tool.id);
    ids.set(tool.id, id);
    if (existing === undefined) tools.push({ ...tool, id });
  }
  return { machine: { ...machine, tools }, ids };
}

export function remapRecipeTools(
  settings: CncLayerSettings,
  ids: ReadonlyMap<string, string>,
): CncLayerSettings {
  const result = { ...cloneRecipeCnc(settings) };
  for (const field of RECIPE_TOOL_FIELDS) {
    const id = settings[field];
    if (id !== undefined) result[field] = ids.get(id) ?? id;
  }
  if (settings.stageRecipes !== undefined) {
    result.stageRecipes = Object.fromEntries(
      CNC_CUTTING_STAGES.flatMap((stage) => {
        const recipe = settings.stageRecipes?.[stage];
        return recipe === undefined
          ? []
          : [[stage, { ...recipe, toolId: ids.get(recipe.toolId) ?? recipe.toolId }]];
      }),
    );
  }
  return result;
}

export function recipeCncToolIds(settings: CncLayerSettings | undefined): ReadonlyArray<string> {
  if (settings === undefined) return [];
  return [
    ...new Set([
      ...RECIPE_TOOL_FIELDS.flatMap((field) => settings[field] ?? []),
      ...CNC_CUTTING_STAGES.flatMap((stage) => settings.stageRecipes?.[stage]?.toolId ?? []),
    ]),
  ];
}

function freeToolId(tools: ReadonlyArray<CncTool>, requested: string): string {
  let id = requested;
  let suffix = 2;
  while (tools.some((tool) => tool.id === id)) id = `${requested}-recipe-${suffix++}`;
  return id;
}

function sameTool(a: CncTool, b: CncTool): boolean {
  const { id: _a, ...left } = a;
  const { id: _b, ...right } = b;
  const keys = Object.keys({ ...left, ...right }) as Array<keyof typeof left>;
  return keys.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
