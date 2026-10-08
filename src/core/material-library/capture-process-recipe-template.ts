import {
  machineKindOf,
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneObject,
} from '../scene';
import { captureProcessRecipeStep, captureProcessRecipeTools } from './capture-process-recipe';
import {
  canonicalProcessRecipe,
  type ProcessRecipe,
  type ProcessRecipeResult,
  type ProcessRecipeRole,
  type ProcessRecipeSelector,
} from './process-recipe';
import { recipePathGeometry } from './process-recipe-geometry';
import { recipeObjectGroupPaths } from './process-recipe-selectors';

/** Capture the same revisioned process model, adding reviewable roles from named artwork. */
export function captureProcessRecipeTemplate(
  project: Project,
  objectIds: ReadonlyArray<string>,
  metadata: Pick<ProcessRecipe, 'id' | 'name' | 'description' | 'revision'>,
): ProcessRecipeResult<ProcessRecipe> {
  if (machineKindOf(project.machine) !== 'cnc')
    return { kind: 'invalid', reason: 'Switch to CNC mode to save a machining template.' };
  const ids = new Set(objectIds);
  const targets = project.scene.objects.filter((object) => ids.has(object.id));
  if (targets.length === 0 || targets.some((object) => !('paths' in object)))
    return { kind: 'invalid', reason: 'Select vector artwork to save a machining template.' };
  if (metadata.name.trim() === '')
    return { kind: 'invalid', reason: 'Give this machining template a name.' };
  const operations = project.scene.layers.filter((operation) =>
    targets.some((object) => sceneObjectUsesOperation(object, operation)),
  );
  if (operations.length === 0)
    return { kind: 'invalid', reason: 'The selection has no operations to save.' };
  const steps = operations.map((operation) =>
    captureProcessRecipeStep(
      project,
      targets.find((object) => sceneObjectUsesOperation(object, operation)) ??
        (targets[0] as SceneObject),
      operation,
    ),
  );
  if (
    operations.some((operation, index) =>
      targets.some(
        (object) =>
          sceneObjectUsesOperation(object, operation) &&
          JSON.stringify(captureProcessRecipeStep(project, object, operation)) !==
            JSON.stringify(steps[index]),
      ),
    )
  )
    return {
      kind: 'invalid',
      reason:
        'Selected artwork has different overrides for a shared operation. Save those processes separately.',
    };
  const tools = captureProcessRecipeTools(project, steps);
  if (tools.kind === 'invalid') return tools;
  const roles = captureTemplateRoles(project, targets, operations);
  return {
    kind: 'ok',
    value: canonicalProcessRecipe({
      ...metadata,
      name: metadata.name.trim(),
      machineKind: 'cnc',
      steps,
      roles,
      tools: tools.value,
    }),
  };
}

function captureTemplateRoles(
  project: Project,
  targets: ReadonlyArray<SceneObject>,
  operations: ReadonlyArray<Layer>,
): ReadonlyArray<ProcessRecipeRole> {
  const roles: ProcessRecipeRole[] = [];
  operations.forEach((operation, stepIndex) => {
    for (const object of targets) {
      if (!('paths' in object)) continue;
      const geometry = [
        ...new Set(
          object.paths
            .filter((path) => pathUsesOperation(object, path, operation))
            .map((path) => recipePathGeometry(path) ?? 'any'),
        ),
      ];
      for (const kind of geometry) {
        const selector: ProcessRecipeSelector = {
          geometry: kind,
          ...(object.name === undefined ? {} : { objectName: object.name }),
          ...(object.kind === 'text' ? { objectKind: 'text' as const } : {}),
          ...(recipeObjectGroupPaths(project.scene, object.id)[0] === undefined
            ? {}
            : { groupPath: recipeObjectGroupPaths(project.scene, object.id)[0] }),
        };
        if (
          roles.some(
            (role) =>
              role.stepIndices[0] === stepIndex &&
              JSON.stringify(role.selector) === JSON.stringify(selector),
          )
        )
          continue;
        roles.push({
          id: `role-${roles.length + 1}`,
          name: `${operation.name}${object.name === undefined ? '' : ` · ${object.name}`}`,
          required: true,
          stepIndices: [stepIndex],
          selector,
        });
      }
    }
  });
  return roles;
}
