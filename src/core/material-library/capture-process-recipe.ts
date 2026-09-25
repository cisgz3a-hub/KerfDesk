import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../effective-output';
import {
  captureLayerOperationSettings,
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  layerFromSubLayer,
  machineKindOf,
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneObject,
} from '../scene';
import {
  canonicalProcessRecipe,
  type ProcessRecipe,
  type ProcessRecipeResult,
  type ProcessRecipeStep,
} from './process-recipe';
import { captureRecipeCnc, RECIPE_TOOL_FIELDS } from './process-recipe-tools';

export function captureProcessRecipe(
  project: Project,
  objectId: string,
  metadata: Pick<ProcessRecipe, 'id' | 'name' | 'description' | 'revision'>,
): ProcessRecipeResult<ProcessRecipe> {
  const object = project.scene.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) return invalid('Select one artwork to save its process.');
  if (metadata.name.trim() === '') return invalid('Give this process recipe a name.');
  const machineKind = machineKindOf(project.machine);
  const operations = project.scene.layers
    .filter((operation) => sceneObjectUsesOperation(object, operation))
    .flatMap((operation) =>
      machineKind === 'laser'
        ? [operation, ...operation.subLayers.map((sub) => layerFromSubLayer(operation, sub))]
        : [operation],
    );
  if (operations.length === 0) return invalid('The selected artwork has no operations to save.');
  const steps = operations.map((operation) => captureStep(project, object, operation));
  const tools = captureTools(project, steps);
  if (tools.kind === 'invalid') return tools;
  return {
    kind: 'ok',
    value: canonicalProcessRecipe({
      ...metadata,
      name: metadata.name.trim(),
      machineKind,
      steps,
      ...pathBindings(object, operations),
      ...(machineKind === 'cnc' ? { tools: tools.value } : {}),
    }),
  };
}

function captureStep(project: Project, object: SceneObject, operation: Layer): ProcessRecipeStep {
  const effective = effectiveOperationForObject(operation, object);
  const settings = captureLayerOperationSettings(effective);
  return {
    name: operation.name,
    color: operation.color,
    output: operation.output,
    visible: operation.visible,
    settings:
      machineKindOf(project.machine) === 'laser'
        ? {
            ...settings,
            power: effectiveObjectPowerPercent(effective, object),
            minPower: effectiveObjectMinPowerPercent(effective, object),
          }
        : settings,
    ...(project.machine?.kind === 'cnc'
      ? { cnc: captureRecipeCnc(operation.cnc ?? DEFAULT_CNC_LAYER_SETTINGS, project.machine) }
      : {}),
    ...(operation.scanOffsetCalibrationMode === undefined
      ? {}
      : { scanOffsetCalibrationMode: operation.scanOffsetCalibrationMode }),
  };
}

function pathBindings(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
): Pick<ProcessRecipe, 'pathSteps'> {
  if (!('paths' in object) || object.paths.length === 0) return {};
  const pathSteps = object.paths.map((path) =>
    operations.flatMap((operation, index) =>
      pathUsesOperation(object, path, operation) ? [index] : [],
    ),
  );
  return pathSteps.every((steps) => steps.length === operations.length) ? {} : { pathSteps };
}

function captureTools(
  project: Project,
  steps: ReadonlyArray<ProcessRecipeStep>,
): ProcessRecipeResult<NonNullable<ProcessRecipe['tools']>> {
  if (project.machine?.kind !== 'cnc') return { kind: 'ok', value: [] };
  const machine = project.machine;
  const available = [...machine.tools, layerCncTool(machine, {})];
  const ids = new Set(
    steps.flatMap((step) => RECIPE_TOOL_FIELDS.flatMap((field) => step.cnc?.[field] ?? [])),
  );
  const tools = [];
  for (const id of ids) {
    const tool = available.find((candidate) => candidate.id === id);
    if (tool === undefined)
      return invalid(`Restore the missing cutter "${id}" before saving this process recipe.`);
    tools.push({ ...tool });
  }
  return { kind: 'ok', value: tools };
}

function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
