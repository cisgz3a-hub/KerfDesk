import { isObject } from './project-shape-primitives';

export const PROJECT_SCENE_LIMITS = {
  layers: 256,
  objects: 10_000,
  groups: 10_000,
  groupMembers: 50_000,
  coloredPaths: 50_000,
  polylines: 100_000,
  points: 250_000,
  curveSubpaths: 100_000,
  curveSegments: 250_000,
} as const;

type SceneArrays = {
  readonly layers: ReadonlyArray<unknown>;
  readonly objects: ReadonlyArray<unknown>;
  readonly groups: ReadonlyArray<unknown>;
};

type GeometryCounts = {
  readonly paths: number;
  readonly polylines: number;
  readonly points: number;
  readonly curveSubpaths: number;
  readonly curveSegments: number;
};

export function validateSceneBudgets(scene: Record<string, unknown>): string | null {
  const arrays = sceneArrays(scene);
  if (arrays === null) return null;
  return validateSceneArrayBudgets(arrays) ?? validateSceneGeometryBudgets(arrays.objects);
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

function validateSceneGeometryBudgets(objects: ReadonlyArray<unknown>): string | null {
  let total: GeometryCounts = emptyGeometryCounts();
  for (const object of objects) {
    total = sumGeometryCounts(total, object);
    const error =
      overBudget('scene.objects.paths', total.paths, PROJECT_SCENE_LIMITS.coloredPaths) ??
      overBudget('scene.objects.polylines', total.polylines, PROJECT_SCENE_LIMITS.polylines) ??
      overBudget('scene.objects.points', total.points, PROJECT_SCENE_LIMITS.points) ??
      overBudget('scene.objects.curves', total.curveSubpaths, PROJECT_SCENE_LIMITS.curveSubpaths) ??
      overBudget(
        'scene.objects.curves.segments',
        total.curveSegments,
        PROJECT_SCENE_LIMITS.curveSegments,
      );
    if (error !== null) return error;
  }
  return null;
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

function sumGeometryCounts(total: GeometryCounts, object: unknown): GeometryCounts {
  const counts = geometryCountsForObject(object);
  return {
    paths: total.paths + counts.paths,
    polylines: total.polylines + counts.polylines,
    points: total.points + counts.points,
    curveSubpaths: total.curveSubpaths + counts.curveSubpaths,
    curveSegments: total.curveSegments + counts.curveSegments,
  };
}

function geometryCountsForObject(object: unknown): GeometryCounts {
  if (!isObject(object)) return emptyGeometryCounts();
  const pathCounts = geometryCountsForPaths(object['paths']);
  const shapeSpecCounts = geometryCountsForShapeSpec(object['spec']);
  return {
    paths: pathCounts.paths,
    polylines: pathCounts.polylines + shapeSpecCounts.polylines,
    points: pathCounts.points + shapeSpecCounts.points,
    curveSubpaths: pathCounts.curveSubpaths,
    curveSegments: pathCounts.curveSegments,
  };
}

function geometryCountsForPaths(paths: unknown): GeometryCounts {
  if (!Array.isArray(paths)) return emptyGeometryCounts();
  return paths.reduce(sumPathGeometryCounts, {
    ...emptyGeometryCounts(),
    paths: paths.length,
  });
}

function sumPathGeometryCounts(total: GeometryCounts, path: unknown): GeometryCounts {
  if (!isObject(path)) return total;
  const polylines = Array.isArray(path['polylines']) ? path['polylines'] : [];
  const curves = Array.isArray(path['curves']) ? path['curves'] : [];
  const withPolylines = polylines.reduce(sumPolylineGeometryCounts, {
    ...total,
    polylines: total.polylines + polylines.length,
  });
  return addCurveGeometryCounts(
    {
      ...withPolylines,
      curveSubpaths: withPolylines.curveSubpaths + curves.length,
    },
    curves,
  );
}

function sumPolylineGeometryCounts(total: GeometryCounts, polyline: unknown): GeometryCounts {
  const points =
    isObject(polyline) && Array.isArray(polyline['points']) ? polyline['points'].length : 0;
  return { ...total, points: total.points + points };
}

function addCurveGeometryCounts(
  total: GeometryCounts,
  curves: ReadonlyArray<unknown>,
): GeometryCounts {
  if (total.curveSubpaths > PROJECT_SCENE_LIMITS.curveSubpaths) return total;
  let curveSegments = total.curveSegments;
  for (const curve of curves) {
    if (isObject(curve) && Array.isArray(curve['segments'])) {
      curveSegments += curve['segments'].length;
      if (curveSegments > PROJECT_SCENE_LIMITS.curveSegments) break;
    }
  }
  return { ...total, curveSegments };
}

function emptyGeometryCounts(): GeometryCounts {
  return { paths: 0, polylines: 0, points: 0, curveSubpaths: 0, curveSegments: 0 };
}

function geometryCountsForShapeSpec(spec: unknown): Pick<GeometryCounts, 'polylines' | 'points'> {
  if (!isObject(spec) || spec['kind'] !== 'polyline' || !Array.isArray(spec['points'])) {
    return { polylines: 0, points: 0 };
  }
  return { polylines: 1, points: spec['points'].length };
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
