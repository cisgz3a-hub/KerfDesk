import {
  operationIdsForObject,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type SceneObject,
} from '../scene';
import type { ProcessRecipeBinding } from './process-recipe-application';
import type { ProcessRecipeRoleMatch } from './process-recipe-selectors';

type PathObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;
type BindingContext = {
  readonly object: PathObject;
  readonly layers: ReadonlyArray<Layer>;
  readonly roles: ReadonlyArray<ProcessRecipeRoleMatch>;
  readonly stepIds: ReadonlyMap<number, string>;
  readonly ownedIds: ReadonlySet<string>;
  readonly baseline: ProcessRecipeBinding | undefined;
  readonly replaceEdits: boolean;
};

export function snapshotRecipeBinding(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
): ProcessRecipeBinding {
  return {
    objectId: object.id,
    operationIds: [...(object.operationIds ?? operationIdsForObject(object, layers))],
    ...(!('paths' in object)
      ? {}
      : { pathOperationIds: object.paths.map((path) => [...pathIds(object, path, layers)]) }),
  };
}

export function bindTemplateRoles(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
  roles: ReadonlyArray<ProcessRecipeRoleMatch>,
  stepIds: ReadonlyMap<number, string>,
  ownedIds: ReadonlySet<string>,
  baseline?: ProcessRecipeBinding,
  replaceEdits = false,
): SceneObject {
  if (!('paths' in object)) return object;
  const context: BindingContext = {
    object,
    layers,
    roles,
    stepIds,
    ownedIds,
    baseline,
    replaceEdits,
  };
  const paths = object.paths.map((path, index) => bindTemplatePath(context, path, index));
  if (paths.every((path, index) => path === object.paths[index])) return object;
  const stablePaths = paths.map((path) =>
    path.operationIds === undefined
      ? { ...path, operationIds: [...pathIds(object, path, layers)] }
      : path,
  );
  return {
    ...object,
    paths: stablePaths,
    operationIds: [...new Set(stablePaths.flatMap((path) => path.operationIds ?? []))],
  } as SceneObject;
}
function bindTemplatePath(context: BindingContext, path: ColoredPath, index: number): ColoredPath {
  const { object, baseline, replaceEdits, ownedIds } = context;
  const desired = matchedPathOperationIds(context, index);
  const current = pathIds(object, path, context.layers);
  if (!replaceEdits && pathBindingEdited(context, current, index)) return path;
  if (baseline === undefined && desired.length === 0) return path;
  // First application replaces matched paths. Reapply keeps unrelated operations.
  const retained =
    baseline === undefined && desired.length > 0 ? [] : current.filter((id) => !ownedIds.has(id));
  const operationIds = [...new Set([...retained, ...desired])];
  return sameIds(current, operationIds) && path.operationIds !== undefined
    ? path
    : { ...path, operationIds };
}
function matchedPathOperationIds(context: BindingContext, index: number): ReadonlyArray<string> {
  return [
    ...new Set(
      context.roles.flatMap((role) =>
        role.matches.some(
          (match) => match.objectId === context.object.id && match.pathIndices.includes(index),
        )
          ? role.role.stepIndices.flatMap((step) => context.stepIds.get(step) ?? [])
          : [],
      ),
    ),
  ];
}
function pathBindingEdited(
  context: BindingContext,
  current: ReadonlyArray<string>,
  index: number,
): boolean {
  const previous = context.baseline?.pathOperationIds?.[index] ?? context.baseline?.operationIds;
  return (
    previous !== undefined &&
    context.baseline?.pathOperationIds?.length === context.object.paths.length &&
    !sameIds(current, previous)
  );
}
function pathIds(
  object: SceneObject,
  path: ColoredPath,
  layers: ReadonlyArray<Layer>,
): ReadonlyArray<string> {
  return (
    path.operationIds ??
    object.operationIds ??
    layers.filter((layer) => pathUsesOperation(object, path, layer)).map((layer) => layer.id)
  );
}
export function recipeBindingWasEdited(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
  baseline: ProcessRecipeBinding,
): boolean {
  const current = snapshotRecipeBinding(object, layers);
  // Regenerated text can change path counts; its semantic selector rebinds new glyphs.
  if (current.pathOperationIds?.length !== baseline.pathOperationIds?.length)
    return !sameIds(current.operationIds, baseline.operationIds);
  return JSON.stringify(current) !== JSON.stringify(baseline);
}
function sameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
