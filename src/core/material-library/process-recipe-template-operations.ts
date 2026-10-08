import { sceneObjectUsesOperation, type Layer } from '../scene';
import type { ProcessRecipeStep } from './process-recipe';
import type { ProcessRecipeApplication } from './process-recipe-application';
import type { TemplateApplicationContext } from './process-recipe-application-context';
import {
  preserveRecipeStepEdits,
  recipeStepFromLayer,
  templateOperation,
} from './process-recipe-operation';
import { remapRecipeTools } from './process-recipe-tools';

export function installTemplateOperations(
  context: TemplateApplicationContext,
): ProcessRecipeApplication['operations'] {
  return context.order.flatMap((stepIndex) => installTemplateStep(context, stepIndex) ?? []);
}
function installTemplateStep(
  context: TemplateApplicationContext,
  stepIndex: number,
): ProcessRecipeApplication['operations'][number] | undefined {
  const { project, layers, target, recipe, application, options } = context;
  const step = recipe.steps[stepIndex];
  if (step === undefined) return undefined;
  const previous = application?.operations.find((entry) => entry.stepIndex === stepIndex);
  const current = layers.find((layer) => layer.id === previous?.operationId);
  const matched = context.preview.roles.some(
    (role) => role.status === 'matched' && role.role.stepIndices.includes(stepIndex),
  );
  if (!matched) return previous;
  // An explicitly deleted stage stays deleted on ordinary reapply.
  if (previous !== undefined && current === undefined && !options.replaceOperatorChanges)
    return previous;
  const desired = remappedTemplateStep(
    {
      ...step,
      color: templateStepColor(application, previous, step, stepIndex),
    },
    context.installed.ids,
  );
  const adjusted =
    current !== undefined && previous !== undefined && !options.replaceOperatorChanges
      ? preserveRecipeStepEdits(previous.baseline, recipeStepFromLayer(current), desired)
      : desired;
  const scene = { ...project.scene, layers };
  const candidate = templateOperation(scene, target, adjusted, current);
  const operation = needsIndependentCopy(context, current, candidate)
    ? templateOperation(scene, target, adjusted)
    : candidate;
  const index = layers.findIndex((layer) => layer.id === operation.id);
  if (index === -1) layers.push(operation);
  else layers[index] = operation;
  // Desired values remain the baseline so manual edits stay manual after further reapplies.
  const baseline = templateOperation({ ...project.scene, layers }, target, desired, operation);
  return { stepIndex, operationId: operation.id, baseline: recipeStepFromLayer(baseline) };
}
function needsIndependentCopy(
  context: TemplateApplicationContext,
  current: Layer | undefined,
  candidate: Layer,
): boolean {
  if (
    current === undefined ||
    JSON.stringify(recipeStepFromLayer(current)) === JSON.stringify(recipeStepFromLayer(candidate))
  )
    return false;
  return context.project.scene.objects.some(
    (object) => !context.ids.includes(object.id) && sceneObjectUsesOperation(object, current),
  );
}

function remappedTemplateStep(
  step: ProcessRecipeStep,
  ids: ReadonlyMap<string, string>,
): ProcessRecipeStep {
  return { ...step, ...(step.cnc === undefined ? {} : { cnc: remapRecipeTools(step.cnc, ids) }) };
}

function templateStepColor(
  application: ProcessRecipeApplication | undefined,
  previous: ProcessRecipeApplication['operations'][number] | undefined,
  step: ProcessRecipeStep,
  index: number,
): string {
  return previous !== undefined && application?.recipe.steps[index]?.color === step.color
    ? previous.baseline.color
    : step.color;
}
