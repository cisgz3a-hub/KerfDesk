import {
  captureLayerOperationSettings,
  type CncLayerSettings,
  type CncTool,
  type Layer,
  type LayerOperationSettings,
  type MachineKind,
} from '../scene';

export type ProcessRecipeStep = {
  readonly name: string;
  readonly color: string;
  readonly output: boolean;
  readonly visible: boolean;
  readonly settings: LayerOperationSettings;
  readonly cnc?: CncLayerSettings;
  readonly scanOffsetCalibrationMode?: Layer['scanOffsetCalibrationMode'];
};

/** A frozen process, independent of source operation IDs and material links. */
export type ProcessRecipe = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
  readonly machineKind: MachineKind;
  readonly steps: ReadonlyArray<ProcessRecipeStep>;
  /** Present only for artwork with independently assigned paths. Entries index steps. */
  readonly pathSteps?: ReadonlyArray<ReadonlyArray<number>>;
  readonly tools?: ReadonlyArray<CncTool>;
};

export type ProcessRecipeResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'invalid'; readonly reason: string };

export function cloneRecipeCnc(settings: CncLayerSettings): CncLayerSettings {
  return orderedJsonCopy(settings) as CncLayerSettings;
}

export function canonicalProcessRecipe(recipe: ProcessRecipe): ProcessRecipe {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    revision: recipe.revision,
    machineKind: recipe.machineKind,
    steps: recipe.steps.map((step) => ({
      name: step.name,
      color: step.color,
      output: step.output,
      visible: step.visible,
      settings: captureLayerOperationSettings(step.settings),
      ...(step.cnc === undefined ? {} : { cnc: cloneRecipeCnc(step.cnc) }),
      ...(step.scanOffsetCalibrationMode === undefined
        ? {}
        : { scanOffsetCalibrationMode: step.scanOffsetCalibrationMode }),
    })),
    ...(recipe.pathSteps === undefined
      ? {}
      : { pathSteps: recipe.pathSteps.map((indices) => [...indices]) }),
    ...(recipe.tools === undefined
      ? {}
      : { tools: recipe.tools.map((tool) => orderedJsonCopy(tool) as CncTool) }),
  };
}

/** Stable key order also preserves nested CNC option blocks after native import. */
function orderedJsonCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJsonCopy);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, orderedJsonCopy(item)]),
  );
}
