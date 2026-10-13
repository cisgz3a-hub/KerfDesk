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

export type PartGroups = ReadonlyArray<ReadonlyArray<number>>;
export type TracePartGroupMode = 'fill' | 'stroke';
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
  const mode = tracePartGroupMode(object, path, layers);
  const cached = cachedTracePartGroups(path, mode);
  if (cached !== undefined) return cached;
  const groups = computeTracePartGroups(path, mode);
  cacheTracePartGroups(path, mode, groups);
  return groups;
}

export function tracePartGroupMode(
  object: TracedImage,
  path: ColoredPath,
  layers: ReadonlyArray<Layer>,
): TracePartGroupMode {
  const strokes =
    (object.traceMode === 'centerline' ||
      (object.traceMode === 'hybrid' && isHybridStrokePath(path))) &&
    !hasFillOperation(object, path, layers);
  return strokes ? 'stroke' : 'fill';
}

export function computeTracePartGroups(path: ColoredPath, mode: TracePartGroupMode): PartGroups {
  return mode === 'stroke'
    ? Array.from({ length: subpathCount(path) }, (_, index) => [index])
    : groupSubpathsByOuterShape(path);
}

export function cachedTracePartGroups(
  path: ColoredPath,
  mode: TracePartGroupMode,
): PartGroups | undefined {
  return (mode === 'stroke' ? strokeGroupCache : fillGroupCache).get(path);
}

/** Install worker results only against the immutable path that requested them. */
export function cacheTracePartGroups(
  path: ColoredPath,
  mode: TracePartGroupMode,
  groups: PartGroups,
): void {
  (mode === 'stroke' ? strokeGroupCache : fillGroupCache).set(path, groups);
}

/** Whole groups survive extraction; partial groups must be recomputed. */
export function carryTracePartGroups(
  path: ColoredPath,
  indices: ReadonlyArray<number>,
  subset: ColoredPath,
): void {
  if (
    indices.length !== subpathCount(subset) ||
    !indices.every(
      (index, at) =>
        index >= 0 &&
        index < subpathCount(path) &&
        (at === 0 || index > (indices[at - 1] as number)),
    )
  )
    return;
  const position = new Map(indices.map((original, index) => [original, index]));
  for (const mode of ['fill', 'stroke'] as const) {
    const groups = cachedTracePartGroups(path, mode);
    if (groups === undefined) continue;
    const kept: number[][] = [];
    let complete = true;
    for (const group of groups) {
      const mapped = group.flatMap((index) => {
        const next = position.get(index);
        return next === undefined ? [] : [next];
      });
      if (mapped.length === 0) continue;
      if (mapped.length !== group.length) {
        complete = false;
        break;
      }
      kept.push(mapped);
    }
    if (complete) cacheTracePartGroups(subset, mode, kept);
  }
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
