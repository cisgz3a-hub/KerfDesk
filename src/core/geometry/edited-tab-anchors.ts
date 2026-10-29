// edited-tab-anchors — keeps tabs placed by hand where they were when an edit
// redraws an object's contours in place: Edit nodes Delete and Radius / Fillet
// (ADR-494 Amendment 2), and Optimize Shapes (Amendment 3). A tab is a fraction
// of its contour from the start (ADR-156), and these edits can move the start,
// so each tab on a changed contour is re-measured at its old place, or at the
// nearest point of the new outline when the edit removed that place. Tabs on
// contours the edit left unchanged keep their anchors exactly.
//
// An object rebuilt from its settings at a new size (a resized rounded
// rectangle, a Shape Properties edit) has a new outline with its own start and
// its own shares of edge and corner. Each tab there goes where the plain
// stretch of the old box onto the new one puts it, on the nearest point of the
// rebuilt outline (Amendment 3).
//
// Pure core — no I/O, no globals, deterministic.

import {
  createCncTabAnchorPositionResolver,
  createTabPolylineProjector,
} from '../cnc/cnc-tab-anchors';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  IDENTITY_TRANSFORM,
  flattenColoredPathCurves,
  type Bounds,
  type CncTabAnchor,
  type ColoredPath,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';

// A tab whose old place lies farther than this from the new outline sat on a
// part the edit changed, and is reported as moved. Twice the flattening
// tolerance: the old and new outlines are each that close to the true curve.
export const TAB_KEPT_PLACE_MM = 2 * DEFAULT_MACHINE_CURVE_TOLERANCE_MM;

export type FollowedTabs<T extends SceneObject> = {
  readonly object: T;
  /** Tabs that sat on a changed part of the outline and moved onto the new one. */
  readonly moved: number;
};

type Projector = ReturnType<typeof createTabPolylineProjector>;

// Where a place on the old artwork lies in the rebuilt artwork's own
// coordinates, and how much the stretch enlarges the old outline's flattening.
type Stretch = { readonly place: (point: Vec2) => Vec2; readonly factor: number };

/** `after`, with every tab placed by hand on a contour the edit changed re-measured
 *  from `before`. The edit keeps each contour's index, as Delete and Fillet do. */
export function withTabsFollowingEdit<T extends SceneObject>(
  before: SceneObject,
  after: T,
): FollowedTabs<T> {
  return followTabs(before, after, null);
}

/** `after`, `before` rebuilt from its settings with its contours in the same
 *  order, with every tab placed by hand where stretching `before`'s box onto
 *  `after`'s puts it, on the nearest point of the rebuilt outline. */
export function withTabsFollowingRebuild<T extends SceneObject>(
  before: SceneObject,
  after: T,
): FollowedTabs<T> {
  return followTabs(before, after, boxStretch(before.bounds, after.bounds));
}

function followTabs<T extends SceneObject>(
  before: SceneObject,
  after: T,
  stretch: Stretch | null,
): FollowedTabs<T> {
  if (!('paths' in before) || !('paths' in after)) return { object: after, moved: 0 };
  if (after.cncTabAnchors === undefined && after.laserTabAnchors === undefined) {
    return { object: after, moved: 0 };
  }
  // Measure in the artwork's own coordinates, which the edit does not move, on
  // closed copies: a broken contour holds its tabs for the line that closes it.
  const locate = createCncTabAnchorPositionResolver(measurementCopy(before));
  const contoursBefore = new Map<number, ReadonlyArray<Polyline>>();
  const contoursAfter = new Map<number, ReadonlyArray<Polyline>>();
  const projectors = new Map<Polyline, Projector>();
  // A stretch enlarges the old outline's flattening error with it.
  const keptPlaceMm =
    stretch === null
      ? TAB_KEPT_PLACE_MM
      : DEFAULT_MACHINE_CURVE_TOLERANCE_MM * (1 + stretch.factor);
  // Where a tab belongs on its new contour, or null when it keeps its anchor.
  const target = (
    anchor: CncTabAnchor,
  ): { readonly place: Vec2; readonly next: Polyline } | null => {
    const sourcePath = before.paths[anchor.pathIndex];
    const editedPath = after.paths[anchor.pathIndex];
    if (sourcePath === undefined || editedPath === undefined) return null;
    if (stretch === null && sourcePath === editedPath) return null;
    const old = cached(contoursBefore, anchor.pathIndex, sourcePath)[anchor.polylineIndex];
    const next = cached(contoursAfter, anchor.pathIndex, editedPath)[anchor.polylineIndex];
    if (old === undefined || next === undefined) return null;
    if (stretch === null && sameOutline(old, next)) return null;
    const located = locate(anchor);
    if (located === null) return null;
    return { place: stretch === null ? located : stretch.place(located), next };
  };
  let moved = 0;
  const follow = <A extends CncTabAnchor>(anchors: ReadonlyArray<A>): ReadonlyArray<A> =>
    anchors.map((anchor) => {
      const found = target(anchor);
      if (found === null) return anchor;
      let project = projectors.get(found.next);
      if (project === undefined) {
        project = createTabPolylineProjector({ ...found.next, closed: true });
        projectors.set(found.next, project);
      }
      const projected = project(found.place);
      if (projected === null) return anchor;
      if (Math.sqrt(projected.distanceSq) > keptPlaceMm) moved += 1;
      return projected.pathT === anchor.pathT ? anchor : { ...anchor, pathT: projected.pathT };
    });
  const object = {
    ...after,
    ...(after.cncTabAnchors === undefined ? {} : { cncTabAnchors: follow(after.cncTabAnchors) }),
    ...(after.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: follow(after.laserTabAnchors) }),
  };
  return { object, moved };
}

// Each axis of the old box onto the new one; an axis without size keeps its scale.
function boxStretch(from: Bounds, to: Bounds): Stretch {
  const x = axisStretch(from.maxX - from.minX, to.maxX - to.minX);
  const y = axisStretch(from.maxY - from.minY, to.maxY - to.minY);
  return {
    place: (point) => ({
      x: to.minX + (point.x - from.minX) * x,
      y: to.minY + (point.y - from.minY) * y,
    }),
    factor: Math.max(1, x, y),
  };
}

function axisStretch(from: number, to: number): number {
  return Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0 ? to / from : 1;
}

function measurementCopy(object: SceneObject & { readonly paths: ReadonlyArray<ColoredPath> }) {
  return {
    ...object,
    transform: IDENTITY_TRANSFORM,
    paths: object.paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((line) => ({ ...line, closed: true })),
      ...(path.curves === undefined
        ? {}
        : { curves: path.curves.map((curve) => ({ ...curve, closed: true })) }),
    })),
  };
}

// The contours as the tab resolvers flatten them, closed like the measurement copy.
function cached(
  cache: Map<number, ReadonlyArray<Polyline>>,
  pathIndex: number,
  path: ColoredPath,
): ReadonlyArray<Polyline> {
  const existing = cache.get(pathIndex);
  if (existing !== undefined) return existing;
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  const polylines = flattened.kind === 'ok' ? flattened.polylines : [];
  cache.set(pathIndex, polylines);
  return polylines;
}

// The same points from the same start: every tab on it is already in place.
function sameOutline(a: Polyline, b: Polyline): boolean {
  const left = withoutClosingPoint(a.points);
  const right = withoutClosingPoint(b.points);
  return (
    left.length === right.length &&
    left.every((point, index) => point.x === right[index]?.x && point.y === right[index]?.y)
  );
}

function withoutClosingPoint(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points.at(-1);
  return points.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
    ? points.slice(0, -1)
    : points;
}
