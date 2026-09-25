import {
  bindSceneObjectToOperations,
  createArtworkOperation,
  machineKindOf,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneObject,
} from '../scene';
import { pruneSceneObjectOperationOverrides } from '../scene/operation-binding';
import { type ProcessRecipe, type ProcessRecipeResult } from './process-recipe';
import { installRecipeTools, remapRecipeTools } from './process-recipe-tools';

/** Replace the selected artwork's process without changing shared operations. */
export function applyProcessRecipe(
  project: Project,
  objectIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
): ProcessRecipeResult<Project> {
  if (machineKindOf(project.machine) !== recipe.machineKind)
    return {
      kind: 'invalid',
      reason: `Switch to ${recipe.machineKind === 'cnc' ? 'CNC' : 'Laser'} mode to apply this recipe.`,
    };
  const ids = new Set(objectIds);
  const targets = project.scene.objects.filter((object) => ids.has(object.id));
  if (targets.length === 0)
    return { kind: 'invalid', reason: 'Select artwork to receive this process recipe.' };
  if (
    recipe.pathSteps !== undefined &&
    targets.some(
      (object) => !('paths' in object) || object.paths.length !== recipe.pathSteps?.length,
    )
  ) {
    return {
      kind: 'invalid',
      reason: `This recipe assigns individual paths. Select artwork with ${recipe.pathSteps.length} paths in the same order.`,
    };
  }
  const installed =
    project.machine?.kind === 'cnc' ? installRecipeTools(project.machine, recipe) : null;
  const layers = [...project.scene.layers];
  const replacements = new Map<string, SceneObject>();
  for (const target of targets) {
    const clean = cleanTarget(target, recipe.machineKind);
    const operations = recipe.steps.map((step) => {
      const seed = createArtworkOperation({ ...project.scene, layers }, clean, {
        name: step.name,
      }).operation;
      const operation: Layer = {
        ...seed,
        ...step.settings,
        name: step.name,
        color: layers.some((layer) => layer.color === step.color) ? seed.color : step.color,
        output: step.output,
        visible: step.visible,
        ...(step.cnc === undefined
          ? {}
          : { cnc: remapRecipeTools(step.cnc, installed?.ids ?? new Map()) }),
        ...(step.scanOffsetCalibrationMode === undefined
          ? {}
          : { scanOffsetCalibrationMode: step.scanOffsetCalibrationMode }),
      };
      layers.push(operation);
      return operation;
    });
    replacements.set(target.id, bindRecipe(clean, recipe, operations));
  }
  const objects = project.scene.objects.map((object) => replacements.get(object.id) ?? object);
  // Remove only replaced operations that became orphaned. Keep unrelated empty
  // operations and every operation still used by unselected artwork.
  const replacedIds = new Set(
    project.scene.layers
      .filter((layer) => targets.some((object) => sceneObjectUsesOperation(object, layer)))
      .map((layer) => layer.id),
  );
  const kept = layers.filter(
    (layer) =>
      !replacedIds.has(layer.id) ||
      objects.some((object) => sceneObjectUsesOperation(object, layer)),
  );
  return {
    kind: 'ok',
    value: {
      ...project,
      ...(installed === null ? {} : { machine: installed.machine }),
      scene: {
        ...project.scene,
        objects: pruneSceneObjectOperationOverrides(objects, kept),
        layers: kept,
      },
    },
  };
}

function cleanTarget(object: SceneObject, kind: ProcessRecipe['machineKind']): SceneObject {
  const { operationOverride: _override, ...clean } = object;
  return kind === 'laser' ? ({ ...clean, powerScale: 100 } as SceneObject) : (clean as SceneObject);
}

function bindRecipe(
  object: SceneObject,
  recipe: ProcessRecipe,
  operations: ReadonlyArray<Layer>,
): SceneObject {
  const bound = bindSceneObjectToOperations(
    object,
    operations.map((operation) => operation.id),
  );
  if (recipe.pathSteps === undefined || !('paths' in bound)) return bound;
  return {
    ...bound,
    paths: bound.paths.map((path, index) => ({
      ...path,
      operationIds: (recipe.pathSteps?.[index] ?? []).flatMap((step) => operations[step]?.id ?? []),
    })),
  } as SceneObject;
}
