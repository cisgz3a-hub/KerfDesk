// Operator-set closed Line cut start points (ADR-385, LightBurn "Set Start
// Point": https://docs.lightburnsoftware.com/latest/Reference/SetStartPoint/).
//
// Stored like ADR-156 CNC tab anchors: a closed contour (path and polyline
// index) plus a fraction of its local perimeter, measured on the contour
// flattened at the machine curve tolerance. The start therefore rides along
// through move, rotate, mirror and scale, and stays near its node when other
// nodes are edited. Geometry is never rewritten, so clearing a start point
// restores the drawn start exactly.

import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM, flattenColoredPathCurves } from './curve-path';
import type { ColoredPath, CutStartPoint, Polyline, SceneObject, Vec2 } from './scene-object';

const EPS = 1e-9;

type Edge = { readonly start: Vec2; readonly end: Vec2; readonly length: number };

/** The start point for the closed contour through `localPoint`, or null when
 * the contour is missing, open or degenerate. */
export function cutStartPointAt(
  path: ColoredPath,
  pathIndex: number,
  polylineIndex: number,
  localPoint: Vec2,
): CutStartPoint | null {
  const polyline = flattenedContour(path, polylineIndex);
  if (polyline === null) return null;
  const pathT = perimeterFractionNearest(polyline.points, localPoint);
  return pathT === null ? null : { pathIndex, polylineIndex, pathT };
}

/** Where a stored start sits on its contour, in the object's local frame. */
export function cutStartLocalPosition(path: ColoredPath, start: CutStartPoint): Vec2 | null {
  const polyline = flattenedContour(path, start.polylineIndex);
  return polyline === null ? null : pointAtPerimeterFraction(polyline.points, start.pathT);
}

/** Replace any start already stored for the same contour. */
export function withCutStartPoint<T extends SceneObject>(object: T, start: CutStartPoint): T {
  const others = (object.cutStartPoints ?? []).filter(
    (existing) =>
      existing.pathIndex !== start.pathIndex || existing.polylineIndex !== start.polylineIndex,
  );
  return { ...object, cutStartPoints: [...others, start] };
}

export function withoutCutStartPoints<T extends SceneObject>(object: T): T {
  if (object.cutStartPoints === undefined) return object;
  const { cutStartPoints: _cleared, ...rest } = object;
  return rest as T;
}

function flattenedContour(path: ColoredPath, polylineIndex: number): Polyline | null {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (flattened.kind !== 'ok') return null;
  const polyline = flattened.polylines[polylineIndex];
  return polyline?.closed === true ? polyline : null;
}

function loopEdges(points: ReadonlyArray<Vec2>): ReadonlyArray<Edge> {
  const edges: Edge[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i] as Vec2;
    const end = points[(i + 1) % points.length] as Vec2;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > EPS) edges.push({ start, end, length });
  }
  return edges;
}

function perimeterFractionNearest(points: ReadonlyArray<Vec2>, target: Vec2): number | null {
  const edges = loopEdges(points);
  const total = edges.reduce((sum, edge) => sum + edge.length, 0);
  if (total <= EPS) return null;
  let travelled = 0;
  let best = { distanceSq: Number.POSITIVE_INFINITY, along: 0 };
  for (const edge of edges) {
    const dx = edge.end.x - edge.start.x;
    const dy = edge.end.y - edge.start.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((target.x - edge.start.x) * dx + (target.y - edge.start.y) * dy) / edge.length ** 2,
      ),
    );
    const distanceSq =
      (edge.start.x + dx * t - target.x) ** 2 + (edge.start.y + dy * t - target.y) ** 2;
    if (distanceSq < best.distanceSq) best = { distanceSq, along: travelled + edge.length * t };
    travelled += edge.length;
  }
  return best.along / total;
}

function pointAtPerimeterFraction(points: ReadonlyArray<Vec2>, fraction: number): Vec2 | null {
  const edges = loopEdges(points);
  const total = edges.reduce((sum, edge) => sum + edge.length, 0);
  if (total <= EPS || !Number.isFinite(fraction)) return null;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let travelled = 0;
  for (const edge of edges) {
    if (target <= travelled + edge.length + EPS) {
      const t = Math.max(0, Math.min(1, (target - travelled) / edge.length));
      return {
        x: edge.start.x + (edge.end.x - edge.start.x) * t,
        y: edge.start.y + (edge.end.y - edge.start.y) * t,
      };
    }
    travelled += edge.length;
  }
  return edges[0]?.start ?? null;
}
