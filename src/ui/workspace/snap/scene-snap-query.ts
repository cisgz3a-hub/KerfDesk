// scene-snap-query — the one snap target nearest the pointer, over the whole
// scene (LightBurn gap LBG-F06).
//
// Targets come only from artwork the operator can see and edit: locked objects
// and hidden layers never capture the pointer (the same rule as the box
// alignment guides, snap-target-visibility.ts). Objects are first rejected by
// their box; each surviving path is searched through its cached local index, so
// a query costs the geometry NEAR the pointer, never every vertex of a big
// trace. A hard scan budget caps even the pathological case — a whole trace
// zoomed out under the snap radius.

import {
  applyTransform,
  sceneLayerVisibility,
  transformedBBox,
  type ColoredPath,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../../core/scene';
import { visibleSnapTargetPredicate } from '../snap-target-visibility';
import { forEachEntryNear } from './cell-grid';
import { POINT_CENTER, POINT_NODE } from './path-snap-points';
import { pathPointIndex, pathSegmentIndex, type PathPointIndex } from './path-snap-index';
import {
  affineFromTransform,
  applyAffine,
  boxAround,
  boxesOverlap,
  invertAffine,
  mapBox,
  type Affine,
  type Box,
} from './snap-affine';
import {
  isObjectCentreMoving,
  isObjectSearched,
  isPointMoving,
  isSegmentMoving,
  subpathKey,
  type SnapExclusion,
} from './snap-exclusion';
import { nearestCrossing, type WorldSegment } from './snap-intersections';
import { isBetterPointSnap, type PointSnapKind, type PointSnapTarget } from './snap-kinds';

// Entries examined per query before the search settles for what it has.
export const SNAP_SCAN_BUDGET = 50_000;

export type PointSnapQuery = {
  readonly project: Project;
  readonly pointMm: Vec2;
  readonly radiusMm: number;
  readonly kinds: ReadonlySet<PointSnapKind>;
  readonly exclusion?: SnapExclusion;
  readonly ranking?: 'priority' | 'distance';
};

type LayerLookup = ReturnType<typeof sceneLayerVisibility.lookup>;
type EditableObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

type ObjectFrame = {
  readonly object: EditableObject;
  readonly toWorld: Affine;
  readonly localBox: Box;
};

class SnapSearch {
  private best: PointSnapTarget | null = null;
  private budget = SNAP_SCAN_BUDGET;
  readonly segments: WorldSegment[] = [];
  readonly queryBox: Box;

  constructor(readonly query: PointSnapQuery) {
    this.queryBox = boxAround(query.pointMm, query.radiusMm);
  }

  get exhausted(): boolean {
    return this.budget <= 0;
  }

  spend(): boolean {
    this.budget -= 1;
    return this.budget > 0;
  }

  consider(kind: PointSnapKind, pointMm: Vec2, objectId: string): void {
    if (!this.query.kinds.has(kind)) return;
    const distanceMm = Math.hypot(
      pointMm.x - this.query.pointMm.x,
      pointMm.y - this.query.pointMm.y,
    );
    if (!(distanceMm <= this.query.radiusMm)) return;
    const candidate = { kind, pointMm, distanceMm, objectId };
    if (isBetterPointSnap(candidate, this.best, this.query.ranking)) this.best = candidate;
  }

  result(): PointSnapTarget | null {
    if (this.query.kinds.has('intersection') && this.segments.length > 1) {
      const crossing = nearestCrossing(this.segments, this.query.pointMm, this.query.radiusMm);
      if (crossing !== null) this.consider('intersection', crossing.pointMm, crossing.objectId);
    }
    return this.best;
  }
}

export function findPointSnap(query: PointSnapQuery): PointSnapTarget | null {
  if (!(query.radiusMm > 0) || !Number.isFinite(query.radiusMm) || query.kinds.size === 0) {
    return null;
  }
  const { layers, objects } = query.project.scene;
  const search = new SnapSearch(query);
  const isVisible = visibleSnapTargetPredicate(layers);
  const lookup = sceneLayerVisibility.lookup(layers);
  for (const object of objects) {
    if (search.exhausted) break;
    if (object.locked === true || !isObjectSearched(object.id, query.exclusion)) continue;
    if (!isVisible(object) || !boxesOverlap(transformedBBox(object), search.queryBox)) continue;
    searchObject(search, object, lookup);
  }
  return search.result();
}

function searchObject(search: SnapSearch, object: SceneObject, lookup: LayerLookup): void {
  if (!isObjectCentreMoving(object.id, search.query.exclusion)) {
    const b = object.bounds;
    const centre = applyTransform(
      { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      object.transform,
    );
    search.consider('center', centre, object.id);
  }
  if (!('paths' in object)) return;
  const toWorld = affineFromTransform(object.transform);
  const toLocal = invertAffine(toWorld);
  if (toLocal === null) return;
  const frame: ObjectFrame = { object, toWorld, localBox: mapBox(toLocal, search.queryBox) };
  object.paths.forEach((path, pathIndex) => {
    if (search.exhausted) return;
    if (!sceneLayerVisibility.resolvePath(object, path, lookup).visible) return;
    searchPathPoints(search, frame, path, pathIndex);
    if (search.query.kinds.has('intersection')) searchPathSegments(search, frame, path, pathIndex);
  });
}

function searchPathPoints(
  search: SnapSearch,
  frame: ObjectFrame,
  path: ColoredPath,
  pathIndex: number,
): void {
  const index = pathPointIndex(path);
  forEachEntryNear(index.grid, frame.localBox, (entry) => {
    const kind = pointKind(index.kinds[entry] ?? POINT_NODE);
    if (search.query.kinds.has(kind) && !isExcludedPoint(search, frame, index, pathIndex, entry)) {
      const world = applyAffine(frame.toWorld, index.xs[entry] ?? 0, index.ys[entry] ?? 0);
      search.consider(kind, world, frame.object.id);
    }
    return search.spend();
  });
}

function isExcludedPoint(
  search: SnapSearch,
  frame: ObjectFrame,
  index: PathPointIndex,
  pathIndex: number,
  entry: number,
): boolean {
  const moving = search.query.exclusion?.movingNodes;
  if (moving === undefined || moving.objectId !== frame.object.id) return false;
  const subpath = index.subpaths[entry] ?? 0;
  return isPointMoving({
    moving,
    pathIndex,
    subpath,
    kind: pointKind(index.kinds[entry] ?? POINT_NODE),
    item: index.items[entry] ?? 0,
    nodeCount: index.nodeCounts[subpath] ?? 0,
  });
}

function searchPathSegments(
  search: SnapSearch,
  frame: ObjectFrame,
  path: ColoredPath,
  pathIndex: number,
): void {
  const index = pathSegmentIndex(path);
  const moving = search.query.exclusion?.movingNodes;
  const seen = new Set<number>();
  forEachEntryNear(index.grid, frame.localBox, (entry) => {
    if (seen.has(entry)) return true;
    seen.add(entry);
    const subpath = index.subpaths[entry] ?? 0;
    const excluded =
      moving !== undefined &&
      moving.objectId === frame.object.id &&
      isSegmentMoving({ moving, pathIndex, subpath, alignedWithCurves: index.alignedWithCurves });
    if (!excluded) {
      const c = index.coords;
      search.segments.push({
        fromMm: applyAffine(frame.toWorld, c[entry * 4] ?? 0, c[entry * 4 + 1] ?? 0),
        toMm: applyAffine(frame.toWorld, c[entry * 4 + 2] ?? 0, c[entry * 4 + 3] ?? 0),
        entityId: frame.object.id,
        subpathKey: `${frame.object.id}|${subpathKey(pathIndex, subpath)}`,
      });
    }
    return search.spend();
  });
}

function pointKind(code: number): 'node' | 'midpoint' | 'center' {
  if (code === POINT_NODE) return 'node';
  return code === POINT_CENTER ? 'center' : 'midpoint';
}
