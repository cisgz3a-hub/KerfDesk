import { groupAncestors, objectDirectGroups } from '../scene/design-hierarchy-membership';
import { isRegistrationBox } from '../scene/registration-layer';
import type { Project, Scene, SceneObject } from '../scene';
import type { ProcessRecipe, ProcessRecipeRole, ProcessRecipeSelector } from './process-recipe';
import type { ProcessRecipeApplication } from './process-recipe-application';
import { matchesRecipeGeometry } from './process-recipe-geometry';
import { recipeBindingWasEdited } from './process-recipe-binding';
import { recipeStepEditedFields, recipeStepFromLayer } from './process-recipe-operation';
import { installRecipeTools } from './process-recipe-tools';

export type ProcessRecipeRoleMatch = {
  readonly role: ProcessRecipeRole;
  readonly matches: ReadonlyArray<{
    readonly objectId: string;
    readonly pathIndices: ReadonlyArray<number>;
  }>;
  readonly status: 'matched' | 'missing';
};
export type ProcessRecipePreview = {
  readonly signature: string;
  readonly roles: ReadonlyArray<ProcessRecipeRoleMatch>;
  readonly matchedObjectIds: ReadonlyArray<string>;
  readonly unmatchedObjectIds: ReadonlyArray<string>;
  readonly missingRoleIds: ReadonlyArray<string>;
  readonly toolRemaps: ReadonlyArray<{
    readonly name: string;
    readonly from: string;
    readonly to: string;
  }>;
  readonly retainedApplicationId?: string;
  readonly warnings: ReadonlyArray<string>;
};

export function previewProcessRecipe(
  project: Project,
  objectIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
  application?: ProcessRecipeApplication,
): ProcessRecipePreview {
  const ids = new Set(objectIds);
  const objects = project.scene.objects.filter(
    (object) => ids.has(object.id) && !isRegistrationBox(object),
  );
  const roles = (recipe.roles ?? []).map((role): ProcessRecipeRoleMatch => {
    const matches = objects.flatMap((object) => {
      const pathIndices = recipeSelectorPaths(project.scene, object, role.selector);
      return pathIndices.length === 0 ? [] : [{ objectId: object.id, pathIndices }];
    });
    return { role, matches, status: matches.length === 0 ? 'missing' : 'matched' };
  });
  const matched = new Set(roles.flatMap((role) => role.matches.map((match) => match.objectId)));
  const installed =
    project.machine?.kind === 'cnc' ? installRecipeTools(project.machine, recipe) : null;
  const warnings = [...templateWarnings(objects, roles), ...retainedWarnings(project, application)];
  return {
    signature: recipePreviewSignature(project, objectIds, recipe, application),
    roles,
    matchedObjectIds: [...matched],
    unmatchedObjectIds: objects
      .filter((object) => !matched.has(object.id))
      .map((object) => object.id),
    missingRoleIds: roles.filter((role) => role.status === 'missing').map((role) => role.role.id),
    toolRemaps: (recipe.tools ?? []).map((tool) => ({
      name: tool.name,
      from: tool.id,
      to: installed?.ids.get(tool.id) ?? tool.id,
    })),
    ...(application === undefined ? {} : { retainedApplicationId: application.id }),
    warnings,
  };
}

export function recipeSelectorPaths(
  scene: Scene,
  object: SceneObject,
  selector: ProcessRecipeSelector,
): number[] {
  if (
    !('paths' in object) ||
    isRegistrationBox(object) ||
    !matchesIdentity(scene, object, selector)
  )
    return [];
  return object.paths.flatMap((path, index) =>
    matchesRecipeGeometry(object, path, selector.geometry) ? [index] : [],
  );
}

function matchesIdentity(
  scene: Scene,
  object: SceneObject,
  selector: ProcessRecipeSelector,
): boolean {
  if (selector.objectKind !== undefined && selector.objectKind !== object.kind) return false;
  const label = object.name ?? ('source' in object ? object.source : '');
  if (selector.objectName !== undefined && normalized(selector.objectName) !== normalized(label))
    return false;
  if (selector.groupPath === undefined) return true;
  return recipeObjectGroupPaths(scene, object.id).some((names) => {
    const expected = selector.groupPath ?? [];
    return (
      names.length >= expected.length &&
      expected.every(
        (name, index) =>
          normalized(name) === normalized(names[names.length - expected.length + index] ?? ''),
      )
    );
  });
}

export function recipeObjectGroupPaths(
  scene: Scene,
  objectId: string,
): ReadonlyArray<ReadonlyArray<string>> {
  return objectDirectGroups(scene, objectId).map((group) =>
    [...groupAncestors(scene, group.id)]
      .reverse()
      .flatMap((id) => scene.groups?.find((item) => item.id === id)?.name ?? []),
  );
}

function templateWarnings(
  objects: ReadonlyArray<SceneObject>,
  roles: ReadonlyArray<ProcessRecipeRoleMatch>,
): string[] {
  const result: string[] = [];
  for (const role of roles) {
    if (role.status === 'missing')
      result.push(
        `${role.role.name}: ${role.role.required ? 'required' : 'optional'} role has no matched vectors.`,
      );
    for (const match of role.matches) {
      const object = objects.find((item) => item.id === match.objectId);
      if (object === undefined || !('paths' in object)) continue;
      for (const index of match.pathIndices) {
        const path = object.paths[index];
        if (path?.polylines.some((line) => line.points.length < (line.closed ? 3 : 2)))
          result.push(
            `${role.role.name}: ${object.name ?? object.id} contains a zero-span or incomplete vector. Inspect it with the vector repair tools.`,
          );
      }
    }
  }
  return [...new Set(result)].slice(0, 100);
}

function recipePreviewSignature(
  project: Project,
  objectIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
  application: ProcessRecipeApplication | undefined,
): string {
  const source = JSON.stringify({
    scene: project.scene,
    machine: project.machine,
    ids: [...new Set(objectIds)].sort(),
    recipe,
    application,
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1)
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `${source.length}:${(hash >>> 0).toString(16)}`;
}
function retainedWarnings(
  project: Project,
  application: ProcessRecipeApplication | undefined,
): string[] {
  if (application === undefined) return [];
  const warnings: string[] = [];
  for (const operation of application.operations) {
    const layer = project.scene.layers.find((layer) => layer.id === operation.operationId);
    if (layer === undefined) {
      warnings.push(operation.baseline.name + ': deleted operation stays deleted on reapply.');
      continue;
    }
    const fields = recipeStepEditedFields(operation.baseline, recipeStepFromLayer(layer));
    if (fields.length > 0)
      warnings.push(layer.name + ': keeps operator edits to ' + fields.join(', ') + '.');
  }
  for (const binding of application.bindings) {
    const object = project.scene.objects.find((object) => object.id === binding.objectId);
    if (object === undefined)
      warnings.push(
        'Missing artwork ' +
          binding.objectId +
          '; its roles will be reviewed against the remaining artwork.',
      );
    else if (recipeBindingWasEdited(object, project.scene.layers, binding))
      warnings.push((object.name ?? object.id) + ': keeps operator-edited operation bindings.');
  }
  return warnings;
}
function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}
