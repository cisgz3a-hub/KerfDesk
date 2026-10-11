import { groupSubpathsByOuterShape, subpathCount } from '../geometry/outer-shape-groups';
import {
  layerFromSubLayer,
  type ColoredPath,
  type Layer,
  type SceneObject,
  type TracedImage,
} from '../scene';
import { effectiveOperationForObject } from '../scene/effective-operation';
import { pathUsesOperation } from '../scene/operation-binding';
import { isHybridStrokePath } from './hybrid/hybrid-paths';

type PartGroups = ReadonlyArray<ReadonlyArray<number>>;
const fillGroupCache = new WeakMap<ColoredPath, PartGroups>();
const strokeGroupCache = new WeakMap<ColoredPath, PartGroups>();

/** Preserve every bound Fill operation, including secondary and hidden ones. */
function hasFillOperation(
  object: TracedImage,
  path: ColoredPath,
  layers: ReadonlyArray<Layer>,
): boolean {
  return layers.some((layer) =>
    [layer, ...layer.subLayers.map((sub) => layerFromSubLayer(layer, sub))].some(
      (operation) =>
        pathUsesOperation(object, path, operation) &&
        effectiveOperationForObject(operation, object).mode === 'fill',
    ),
  );
}

/** Filled shapes carry holes; independent strokes stay separate unless assigned Fill. */
export function tracePartGroups(
  object: TracedImage,
  pathIndex: number,
  layers: ReadonlyArray<Layer> = [],
): PartGroups {
  const path = object.paths[pathIndex];
  if (path === undefined) return [];
  const strokes =
    (object.traceMode === 'centerline' ||
      (object.traceMode === 'hybrid' && isHybridStrokePath(path))) &&
    !hasFillOperation(object, path, layers);
  const cache = strokes ? strokeGroupCache : fillGroupCache;
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const groups = strokes
    ? Array.from({ length: subpathCount(path) }, (_, index) => [index])
    : groupSubpathsByOuterShape(path);
  cache.set(path, groups);
  return groups;
}

/** A compact remainder must not become a part through Select All or restored selection. */
export function isSingleTracePart(
  object: SceneObject,
  layers: ReadonlyArray<Layer> = [],
): object is TracedImage {
  if (object.kind !== 'traced-image') return false;
  let count = 0;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    count += tracePartGroups(object, pathIndex, layers).length;
    if (count > 1) return false;
  }
  return count === 1;
}
