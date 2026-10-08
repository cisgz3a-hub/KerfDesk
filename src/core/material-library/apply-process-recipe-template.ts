import {
  machineKindOf,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneObject,
} from '../scene';
import { pruneSceneObjectOperationOverrides } from '../scene/operation-binding';
import {
  canonicalProcessRecipe,
  sameRecipeValue,
  type ProcessRecipe,
  type ProcessRecipeResult,
} from './process-recipe';
import type { ProcessRecipeApplication, ProcessRecipeBinding } from './process-recipe-application';
import type {
  ApplyRecipeTemplateOptions,
  TemplateApplicationContext,
} from './process-recipe-application-context';
export type { ApplyRecipeTemplateOptions } from './process-recipe-application-context';
import {
  bindTemplateRoles,
  recipeBindingWasEdited,
  snapshotRecipeBinding,
} from './process-recipe-binding';
import { recipeStepOrder } from './process-recipe-order';
import { previewProcessRecipe } from './process-recipe-selectors';
import { installRecipeTools } from './process-recipe-tools';
import { installTemplateOperations } from './process-recipe-template-operations';

export function findRecipeApplication(
  project: Project,
  objectIds: ReadonlyArray<string>,
  recipeId: string,
): ProcessRecipeApplication | undefined {
  const ids = new Set(objectIds);
  return project.processRecipeApplications?.find(
    (entry) =>
      entry.recipe.id === recipeId &&
      entry.objectIds.length === ids.size &&
      entry.objectIds.every((id) => ids.has(id)),
  );
}

/** Re-select semantic roles and update the existing application in one immutable project change. */
export function applyProcessRecipeTemplate(
  project: Project,
  objectIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
  options: ApplyRecipeTemplateOptions = {},
): ProcessRecipeResult<Project> {
  const prepared = prepareApplication(project, objectIds, recipe, options);
  if (prepared.kind === 'invalid') return prepared;
  const context = prepared.value;
  const operations = installTemplateOperations(context);
  const stepIds = new Map(
    operations
      .filter((entry) => context.layers.some((layer) => layer.id === entry.operationId))
      .map((entry) => [entry.stepIndex, entry.operationId]),
  );
  const owned = new Set(context.application?.operations.map((entry) => entry.operationId));
  const objects = project.scene.objects.map((object) =>
    context.ids.includes(object.id)
      ? bindTemplateRoles(
          object,
          project.scene.layers,
          context.preview.roles,
          stepIds,
          owned,
          context.application?.bindings.find((entry) => entry.objectId === object.id),
          options.replaceOperatorChanges,
        )
      : object,
  );
  const result = completeApplication(context, operations, objects);
  return {
    kind: 'ok',
    value: sameRecipeValue(result, project) ? project : result,
  };
}
function prepareApplication(
  project: Project,
  objectIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
  options: ApplyRecipeTemplateOptions,
): ProcessRecipeResult<TemplateApplicationContext> {
  if (!isMachiningTemplate(project, recipe))
    return invalid('Choose a CNC machining template in CNC mode.');
  const application =
    options.applicationId === undefined
      ? findRecipeApplication(project, objectIds, recipe.id)
      : project.processRecipeApplications?.find((entry) => entry.id === options.applicationId);
  if (options.applicationId !== undefined && application === undefined)
    return invalid('The retained template application no longer exists.');
  const ids = application === undefined ? [...new Set(objectIds)] : [...application.objectIds];
  const preview = previewProcessRecipe(project, ids, recipe, application);
  const error = applicationProblem(
    project,
    application,
    preview.signature,
    preview.matchedObjectIds.length,
    options,
  );
  if (error !== null) return invalid(error);
  const order = recipeStepOrder(recipe.steps);
  if (order === null) return invalid('Template step dependencies are cyclic.');
  const targets = project.scene.objects.filter((object) => ids.includes(object.id));
  const target = targets[0];
  if (target === undefined || project.machine?.kind !== 'cnc')
    return invalid('Select artwork to receive this machining template.');
  return {
    kind: 'ok',
    value: {
      project,
      recipe,
      application,
      ids,
      preview,
      options,
      order,
      targets,
      target,
      installed: installRecipeTools(project.machine, recipe),
      layers: [...project.scene.layers],
    },
  };
}
function isMachiningTemplate(project: Project, recipe: ProcessRecipe): boolean {
  return (
    recipe.roles !== undefined &&
    machineKindOf(project.machine) === 'cnc' &&
    recipe.machineKind === 'cnc'
  );
}
function applicationProblem(
  project: Project,
  application: ProcessRecipeApplication | undefined,
  signature: string,
  matches: number,
  options: ApplyRecipeTemplateOptions,
): string | null {
  if (options.reviewedSignature !== undefined && options.reviewedSignature !== signature)
    return 'The artwork, cutter, recipe or operation changed. Review the template matches again.';
  if (matches === 0)
    return 'No template roles match this artwork. Review the named roles and geometry rules.';
  if (application === undefined && (project.processRecipeApplications?.length ?? 0) >= 32)
    return 'This project already retains 32 machining templates. Use another sheet.';
  return null;
}
function completeApplication(
  context: TemplateApplicationContext,
  operations: ProcessRecipeApplication['operations'],
  objects: ReadonlyArray<SceneObject>,
): Project {
  const { project, targets, layers, application, recipe, ids } = context;
  const replaced = new Set(
    project.scene.layers
      .filter((layer) => targets.some((object) => sceneObjectUsesOperation(object, layer)))
      .map((layer) => layer.id),
  );
  const kept = layers.filter(
    (layer) =>
      operations.some((entry) => entry.operationId === layer.id) ||
      !replaced.has(layer.id) ||
      objects.some((object) => sceneObjectUsesOperation(object, layer)),
  );
  const retained: ProcessRecipeApplication = {
    id: application?.id ?? freeApplicationId(project),
    recipe: canonicalProcessRecipe(recipe),
    objectIds: ids,
    operations,
    bindings: objects
      .filter((object) => ids.includes(object.id))
      .map((object) => applicationBinding(context, object, kept)),
  };
  const previous = project.processRecipeApplications ?? [];
  const applications =
    application === undefined
      ? [...previous, retained]
      : previous.map((entry) => (entry.id === retained.id ? retained : entry));
  return {
    ...project,
    machine: context.installed.machine,
    processRecipeApplications: applications,
    scene: {
      ...project.scene,
      objects: pruneSceneObjectOperationOverrides(objects, kept),
      layers: kept,
    },
  };
}
function applicationBinding(
  context: TemplateApplicationContext,
  object: SceneObject,
  kept: ReadonlyArray<Layer>,
): ProcessRecipeBinding {
  const previous = context.application?.bindings.find((binding) => binding.objectId === object.id);
  const original = context.targets.find((target) => target.id === object.id);
  if (
    !context.options.replaceOperatorChanges &&
    previous !== undefined &&
    original !== undefined &&
    recipeBindingWasEdited(original, context.project.scene.layers, previous)
  )
    return previous;
  return snapshotRecipeBinding(object, kept);
}
function freeApplicationId(project: Project): string {
  let count = 1;
  while (project.processRecipeApplications?.some((entry) => entry.id === `template-${count}`))
    count += 1;
  return `template-${count}`;
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}
