import type { CncTabAnchor, ColoredPath, SceneObject, TracedImage } from '../../core/scene';
import { groupSubpathsByOuterShape, subpathCount } from '../../core/geometry/outer-shape-groups';
import { isHybridStrokePath } from '../../core/trace/hybrid/hybrid-paths';
import { boundsFromColoredPaths } from '../../core/trace/trace-bounds';
import { tracePathSubset } from './trace-break-apart';

type PartGroups = ReadonlyArray<ReadonlyArray<number>>;
const fillGroupCache = new WeakMap<ColoredPath, PartGroups>();
const strokeGroupCache = new WeakMap<ColoredPath, PartGroups>();

/** Filled shapes carry their holes; centerline and hybrid strokes stand alone. */
export function tracePartGroups(object: TracedImage, pathIndex: number): PartGroups {
  const path = object.paths[pathIndex];
  if (path === undefined) return [];
  const strokes =
    object.traceMode === 'centerline' ||
    (object.traceMode === 'hybrid' && isHybridStrokePath(path));
  const cache = strokes ? strokeGroupCache : fillGroupCache;
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const groups = strokes
    ? Array.from({ length: subpathCount(path) }, (_, index) => [index])
    : groupSubpathsByOuterShape(path);
  cache.set(path, groups);
  return groups;
}

/** A whole compact remainder must not become a part through Select All or restored selection. */
export function isSingleTracePart(object: SceneObject): object is TracedImage {
  if (object.kind !== 'traced-image') return false;
  let count = 0;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    count += tracePartGroups(object, pathIndex).length;
    if (count > 1) return false;
  }
  return count === 1;
}

type PathSubset = {
  readonly pathIndex: number;
  readonly indices: ReadonlyArray<number>;
  readonly path: ColoredPath;
};

export type DetachedTracePart = {
  /** Null means the requested part already is the whole object. */
  readonly remainder: TracedImage | null;
  readonly part: TracedImage;
};

/** Materialize only the picked shape and one compact remainder, whatever the trace size. */
export function detachTracePartGeometry(
  object: TracedImage,
  pathIndex: number,
  subpathIndex: number,
  partId: string,
): DetachedTracePart | null {
  if (!Number.isInteger(pathIndex) || !Number.isInteger(subpathIndex)) return null;
  const path = object.paths[pathIndex];
  const indices = tracePartGroups(object, pathIndex).find((group) => group.includes(subpathIndex));
  if (path === undefined || indices === undefined) return null;
  const selected = new Set(indices);
  const remainder = remainderSubsets(object, pathIndex, selected);
  if (remainder.length === 0) return { remainder: null, part: object };
  const chosen = [{ pathIndex, indices, path: tracePathSubset(path, indices) }];
  return {
    remainder: objectSubset(object, object.id, object.source, remainder),
    part: objectSubset(object, partId, `${object.source}#part`, chosen),
  };
}

function remainderSubsets(
  object: TracedImage,
  pickedPathIndex: number,
  picked: ReadonlySet<number>,
): PathSubset[] {
  return object.paths.flatMap((path, pathIndex) => {
    const indices = Array.from({ length: subpathCount(path) }, (_, index) => index).filter(
      (index) => pathIndex !== pickedPathIndex || !picked.has(index),
    );
    if (indices.length === 0) return [];
    return [
      {
        pathIndex,
        indices,
        path: pathIndex === pickedPathIndex ? tracePathSubset(path, indices) : path,
      },
    ];
  });
}

function objectSubset(
  object: TracedImage,
  id: string,
  source: string,
  subsets: ReadonlyArray<PathSubset>,
): TracedImage {
  // Re-tracing a partial result would replace the edits with the entire source.
  const { traceSourceId: _detached, ...metadata } = object;
  const paths = subsets.map((subset) => subset.path);
  return {
    ...metadata,
    id,
    source,
    paths,
    bounds: boundsFromColoredPaths(paths),
    ...(object.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: subsetAnchors(object.cncTabAnchors, subsets) }),
    ...(object.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: subsetAnchors(object.laserTabAnchors, subsets) }),
  };
}

function subsetAnchors(
  anchors: ReadonlyArray<CncTabAnchor>,
  subsets: ReadonlyArray<PathSubset>,
): ReadonlyArray<CncTabAnchor> {
  const remap = new Map(
    subsets.map((subset, pathIndex) => [
      subset.pathIndex,
      {
        pathIndex,
        subpaths: new Map(subset.indices.map((original, index) => [original, index])),
      },
    ]),
  );
  return anchors.flatMap((anchor) => {
    const path = remap.get(anchor.pathIndex);
    const polylineIndex = path?.subpaths.get(anchor.polylineIndex);
    return path === undefined || polylineIndex === undefined
      ? []
      : [{ ...anchor, pathIndex: path.pathIndex, polylineIndex }];
  });
}
