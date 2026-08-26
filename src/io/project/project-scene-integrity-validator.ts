import { isObject } from './project-shape-primitives';

export const PROJECT_SCENE_LIMITS = {
  layers: 256,
  objects: 10_000,
  groups: 10_000,
  groupMembers: 50_000,
} as const;

type SceneArrays = {
  readonly layers: ReadonlyArray<unknown>;
  readonly objects: ReadonlyArray<unknown>;
  readonly groups: ReadonlyArray<unknown>;
};

export function validateSceneBudgets(scene: Record<string, unknown>): string | null {
  const arrays = sceneArrays(scene);
  if (arrays === null) return null;
  // Valid imported geometry can legitimately exceed the former path/point
  // prediction caps (for example a >250k-point SVG). Shape validation still
  // rejects malformed/non-finite values, and compile/materialization retains
  // its factual amplification/engine-failure protections. Persistence itself
  // must not discard already-valid artwork merely because it is dense.
  return validateSceneArrayBudgets(arrays);
}

export function validateSceneIntegrity(scene: Record<string, unknown>): string | null {
  const arrays = sceneArrays(scene);
  if (arrays === null) return null;
  return validateSceneIdentities(arrays);
}

function sceneArrays(scene: Record<string, unknown>): SceneArrays | null {
  const layers = scene['layers'];
  const objects = scene['objects'];
  const groups = scene['groups'] ?? [];
  return Array.isArray(layers) && Array.isArray(objects) && Array.isArray(groups)
    ? { layers, objects, groups }
    : null;
}

function validateSceneArrayBudgets(arrays: SceneArrays): string | null {
  let groupMembers = 0;
  for (const group of arrays.groups) groupMembers += groupMemberCount(group);
  return (
    overBudget('scene.layers', arrays.layers.length, PROJECT_SCENE_LIMITS.layers) ??
    overBudget('scene.objects', arrays.objects.length, PROJECT_SCENE_LIMITS.objects) ??
    overBudget('scene.groups', arrays.groups.length, PROJECT_SCENE_LIMITS.groups) ??
    overBudget('scene.groups.objectIds', groupMembers, PROJECT_SCENE_LIMITS.groupMembers)
  );
}

function validateSceneIdentities(arrays: SceneArrays): string | null {
  const objectIds = idsFor(arrays.objects);
  return (
    validateUniqueIds(arrays.objects, 'scene.objects') ??
    validateUniqueIds(arrays.layers, 'scene.layers') ??
    validateUniqueLayerColors(arrays.layers) ??
    validateUniqueIds(arrays.groups, 'scene.groups') ??
    validateGroupMembers(arrays.groups, objectIds)
  );
}

function groupMemberCount(group: unknown): number {
  return isObject(group) && Array.isArray(group['objectIds']) ? group['objectIds'].length : 0;
}

function overBudget(path: string, count: number, max: number): string | null {
  return count > max ? `invalid \`${path}\`: count ${count} exceeds ${max}` : null;
}

function idsFor(items: ReadonlyArray<unknown>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of items)
    if (isObject(item) && typeof item['id'] === 'string') ids.add(item['id']);
  return ids;
}

function validateUniqueIds(items: ReadonlyArray<unknown>, path: string): string | null {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!isObject(item) || typeof item['id'] !== 'string') continue;
    if (seen.has(item['id'])) return `invalid \`${path}[${index}].id\`: duplicate id`;
    seen.add(item['id']);
  }
  return null;
}

function validateUniqueLayerColors(layers: ReadonlyArray<unknown>): string | null {
  const seen = new Set<string>();
  for (const [index, layer] of layers.entries()) {
    if (!isObject(layer) || typeof layer['color'] !== 'string') continue;
    if (seen.has(layer['color']))
      return `invalid \`scene.layers[${index}].color\`: duplicate color`;
    seen.add(layer['color']);
  }
  return null;
}

function validateGroupMembers(
  groups: ReadonlyArray<unknown>,
  objectIds: ReadonlySet<string>,
): string | null {
  for (const [index, group] of groups.entries()) {
    if (!isObject(group) || !Array.isArray(group['objectIds'])) continue;
    const error = validateGroupObjectIds(group['objectIds'], objectIds, `scene.groups[${index}]`);
    if (error !== null) return error;
  }
  return null;
}

function validateGroupObjectIds(
  objectIds: ReadonlyArray<unknown>,
  validObjectIds: ReadonlySet<string>,
  path: string,
): string | null {
  const seen = new Set<string>();
  for (const [index, objectId] of objectIds.entries()) {
    if (typeof objectId !== 'string') continue;
    if (!validObjectIds.has(objectId))
      return `invalid \`${path}.objectIds[${index}]\`: dangling id`;
    if (seen.has(objectId)) return `invalid \`${path}.objectIds[${index}]\`: duplicate id`;
    seen.add(objectId);
  }
  return null;
}
