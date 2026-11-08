// Tabs placed by hand through a Design Studio rebuild (ADR-494 Amendment 4). A
// part or a sketch is rebuilt from its dimensions and each of its paths is
// recovered by its name (ADR-573), so the old and the new contour of a tab are
// known. A hole moves by its own definition, so each contour stretches by its
// own box rather than the object's.
//
// Not every dimension is a plain stretch: a bracket's inner corner stays at its
// leg width when its width changes. A contour rebuilt with the same number of
// edges has them in the same order, so a tab stays on its own edge: where the
// stretch puts it if that place is on the edge, otherwise at its old share of
// the edge. A contour with a different number of edges has no matching edge, so
// the tab goes to the nearest point of the new outline, and when that is off the
// stretched place it counts as moved, for the review to say so.
//
// Pure core — no I/O, no globals, deterministic.

import {
  createCncTabAnchorPositionResolver,
  createTabPolylineProjector,
} from '../cnc/cnc-tab-anchors';
import type { Bounds, CncTabAnchor, Polyline, SceneObject, Vec2 } from '../scene';
import {
  boxStretch,
  flattenedContours,
  measurementCopy,
  sameOutline,
  withoutClosingPoint,
  type FollowedTabs,
} from './edited-tab-anchors';
import { maxOf, minOf } from '../util';

type Landing = { readonly point: Vec2; readonly moved: boolean };

/** `after`, with anchors already on its own paths, re-measured from `before`.
 *  `previousPathIndex` names the path of `before` each path of `after` was. */
export function withTabsFollowingRebuiltContours<T extends SceneObject>(
  before: SceneObject,
  after: T,
  previousPathIndex: (pathIndex: number) => number | undefined,
): FollowedTabs<T> {
  if (!('paths' in before) || !('paths' in after)) return { object: after, moved: 0 };
  if (after.cncTabAnchors === undefined && after.laserTabAnchors === undefined) {
    return { object: after, moved: 0 };
  }
  const locate = createCncTabAnchorPositionResolver(measurementCopy(before));
  const contoursBefore = new Map<number, ReadonlyArray<Polyline>>();
  const contoursAfter = new Map<number, ReadonlyArray<Polyline>>();
  let moved = 0;
  const followOne = <A extends CncTabAnchor>(anchor: A): A => {
    const pathIndex = previousPathIndex(anchor.pathIndex);
    const sourcePath = pathIndex === undefined ? undefined : before.paths[pathIndex];
    const editedPath = after.paths[anchor.pathIndex];
    if (pathIndex === undefined || sourcePath === undefined || editedPath === undefined) {
      return anchor;
    }
    const old = flattenedContours(contoursBefore, pathIndex, sourcePath)[anchor.polylineIndex];
    const next = flattenedContours(contoursAfter, anchor.pathIndex, editedPath)[
      anchor.polylineIndex
    ];
    if (old === undefined || next === undefined || sameOutline(old, next)) return anchor;
    const place = locate({ ...anchor, pathIndex });
    if (place === null) return anchor;
    const landing = landOnRebuiltContour(place, old, next);
    const pathT = createTabPolylineProjector({ ...next, closed: true })(landing.point)?.pathT;
    if (pathT === undefined) return anchor;
    if (landing.moved) moved += 1;
    return { ...anchor, pathT };
  };
  const object = {
    ...after,
    ...(after.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: after.cncTabAnchors.map(followOne) }),
    ...(after.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: after.laserTabAnchors.map(followOne) }),
  };
  return { object, moved };
}

function landOnRebuiltContour(place: Vec2, old: Polyline, next: Polyline): Landing {
  const from = withoutClosingPoint(old.points);
  const to = withoutClosingPoint(next.points);
  const stretch = boxStretch(pointBounds(from), pointBounds(to));
  const target = stretch.place(place);
  if (from.length !== to.length) {
    const nearest = nearestOnContour(to, target);
    return { point: nearest.point, moved: nearest.distance > stretch.keptPlaceMm };
  }
  // The same number of edges: the tab's own edge is the one at the same index.
  const edge = nearestOnContour(from, place);
  const start = to[edge.index] as Vec2;
  const end = to[(edge.index + 1) % to.length] as Vec2;
  const stretched = nearestOnEdge(target, start, end);
  return {
    point: stretched.distance <= stretch.keptPlaceMm ? stretched.point : at(start, end, edge.share),
    moved: false,
  };
}

type EdgePoint = { readonly point: Vec2; readonly share: number; readonly distance: number };

function nearestOnContour(
  points: ReadonlyArray<Vec2>,
  target: Vec2,
): EdgePoint & { readonly index: number } {
  let best: EdgePoint & { readonly index: number } = {
    point: points[0] as Vec2,
    share: 0,
    distance: Number.POSITIVE_INFINITY,
    index: 0,
  };
  points.forEach((start, index) => {
    const candidate = nearestOnEdge(target, start, points[(index + 1) % points.length] as Vec2);
    if (candidate.distance < best.distance) best = { ...candidate, index };
  });
  return best;
}

function nearestOnEdge(target: Vec2, start: Vec2, end: Vec2): EdgePoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const share =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSq),
        );
  const point = at(start, end, share);
  return { point, share, distance: Math.hypot(target.x - point.x, target.y - point.y) };
}

function at(start: Vec2, end: Vec2, share: number): Vec2 {
  return { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share };
}

function pointBounds(points: ReadonlyArray<Vec2>): Bounds {
  return {
    minX: minOf(points.map((point) => point.x)),
    minY: minOf(points.map((point) => point.y)),
    maxX: maxOf(points.map((point) => point.x)),
    maxY: maxOf(points.map((point) => point.y)),
  };
}
