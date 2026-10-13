import {
  curveControlPoint,
  curveNodePoint,
  curveSubpathBounds,
  flattenCurveSubpath,
  moveCurveAnchor,
  moveCurveControl,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../../core/scene';
import { deleteCurveNodes } from '../../core/geometry/curve-node-delete';
import type { PathNodeRef } from './path-node-edit-actions';
import { replaceCompatibilityPolylines } from './path-node-edit-path';

export function editPathsNodesByDelta(
  paths: ReadonlyArray<ColoredPath>,
  refs: ReadonlyArray<PathNodeRef>,
  dx: number,
  dy: number,
): { readonly paths: ReadonlyArray<ColoredPath> } | null {
  if (dx === 0 && dy === 0) return null;
  let changed = false;
  const curveRefs = refs.filter((ref) => ref.geometry === 'curve');
  const legacyRefs = groupPathNodeRefsByPolyline(refs.filter((ref) => ref.geometry !== 'curve'));
  const nextPaths = paths.map((originalPath, pathIndex) => {
    const curveEdit = editCurvePathByDelta(originalPath, pathIndex, curveRefs, dx, dy);
    if (curveEdit !== null) {
      changed = true;
      return curveEdit;
    }
    const path = originalPath;
    let pathChanged = false;
    const polylines = path.polylines.map((polyline, polylineIndex) => {
      const polylineRefs = legacyRefs.get(pathNodePolylineKey({ pathIndex, polylineIndex }));
      if (polylineRefs === undefined) return polyline;
      const moved = movePolylineNodes(polyline, polylineRefs, dx, dy);
      if (moved === polyline) return polyline;
      changed = true;
      pathChanged = true;
      return moved;
    });
    // The legacy node editor addresses compatibility-polyline indices. Until
    // handle-aware curve editing lands, discard stale canonical geometry so
    // preview and machine output use the points the user actually changed.
    return pathChanged ? replaceCompatibilityPolylines(path, polylines) : path;
  });
  return changed ? { paths: nextPaths } : null;
}

function movePolylineNodes(
  polyline: Polyline,
  refs: ReadonlyArray<PathNodeRef>,
  dx: number,
  dy: number,
): Polyline {
  const indices = new Set(refs.map((ref) => ref.pointIndex));
  const last = polyline.points.length - 1;
  if (
    polyline.closed &&
    (indices.has(0) || indices.has(last)) &&
    hasDuplicateClosingPoint(polyline.points)
  ) {
    indices.add(0);
    indices.add(last);
  }
  let points: Vec2[] | undefined;
  for (const index of indices) {
    const point = polyline.points[index];
    if (point === undefined) continue;
    points ??= [...polyline.points];
    points[index] = { x: point.x + dx, y: point.y + dy };
  }
  return points === undefined ? polyline : { ...polyline, points };
}

export function deletePathsNodes(
  paths: ReadonlyArray<ColoredPath>,
  refs: ReadonlyArray<PathNodeRef>,
): { readonly paths: ReadonlyArray<ColoredPath> } | null {
  let changed = false;
  let invalid = false;
  const refsByPolyline = groupPathNodeRefsByPolyline(
    refs.filter((ref) => ref.geometry !== 'curve'),
  );
  const nextPaths = paths.map((path, pathIndex) => {
    const curvePath = deleteCurvePathNodes(path, pathIndex, refs);
    if (curvePath === null) {
      invalid = true;
      return path;
    }
    if (curvePath !== path) {
      changed = true;
      return curvePath;
    }
    let pathChanged = false;
    const polylines = path.polylines.map((polyline, polylineIndex) => {
      const polylineRefs = refsByPolyline.get(pathNodePolylineKey({ pathIndex, polylineIndex }));
      if (polylineRefs === undefined) return polyline;
      const edited = deletePolylineNodes(
        polyline,
        new Set(polylineRefs.map((ref) => ref.pointIndex)),
      );
      if (edited === null) {
        invalid = true;
        return polyline;
      }
      if (edited === polyline) return polyline;
      changed = true;
      pathChanged = true;
      return edited;
    });
    return pathChanged ? replaceCompatibilityPolylines(path, polylines) : path;
  });
  if (invalid || !changed) return null;
  return { paths: nextPaths };
}

// Current local-space position of a single node, or null if the ref is out of
// range. Used to turn an absolute drag target into the delta applied to the
// whole selected-node set (audit C6).
export function pathNodePoint(paths: ReadonlyArray<ColoredPath>, ref: PathNodeRef): Vec2 | null {
  if (ref.geometry === 'curve') {
    const curve = paths[ref.pathIndex]?.curves?.[ref.polylineIndex];
    if (curve === undefined) return null;
    return ref.handle === undefined
      ? curveNodePoint(curve, ref.pointIndex)
      : curveControlPoint(curve, ref.pointIndex, ref.handle);
  }
  return paths[ref.pathIndex]?.polylines[ref.polylineIndex]?.points[ref.pointIndex] ?? null;
}

function editCurvePathByDelta(
  path: ColoredPath,
  pathIndex: number,
  refs: ReadonlyArray<PathNodeRef>,
  dx: number,
  dy: number,
): ColoredPath | null {
  if (path.curves === undefined) return null;
  const pathRefs = refs.filter((ref) => ref.pathIndex === pathIndex);
  if (pathRefs.length === 0) return null;
  const curves = [...path.curves];
  let changed = false;
  for (const ref of pathRefs) {
    const curve = curves[ref.polylineIndex];
    if (curve === undefined) continue;
    const next = editCurveRef(curve, ref, dx, dy);
    if (next === null) continue;
    curves[ref.polylineIndex] = next;
    changed = true;
  }
  return changed ? materializeCurvePath(path, curves) : null;
}

function editCurveRef(
  curve: CurveSubpath,
  ref: PathNodeRef,
  dx: number,
  dy: number,
): CurveSubpath | null {
  if (ref.handle === undefined) return moveCurveAnchor(curve, ref.pointIndex, { x: dx, y: dy });
  const control = curveControlPoint(curve, ref.pointIndex, ref.handle);
  return control === null
    ? null
    : moveCurveControl(curve, ref.pointIndex, ref.handle, {
        x: control.x + dx,
        y: control.y + dy,
      });
}

// Selected curve anchors reconnect through deleteCurveNodes; selected handles
// are not nodes. Null refuses the whole delete, as a polyline that would drop
// below its minimum does.
function deleteCurvePathNodes(
  path: ColoredPath,
  pathIndex: number,
  refs: ReadonlyArray<PathNodeRef>,
): ColoredPath | null {
  const sourceCurves = path.curves;
  if (sourceCurves === undefined) return path;
  const nodesByCurve = curveAnchorIndices(refs, pathIndex);
  if (nodesByCurve.size === 0) return path;
  const curves: CurveSubpath[] = [];
  for (const [curveIndex, curve] of sourceCurves.entries()) {
    const nodes = nodesByCurve.get(curveIndex);
    const next = nodes === undefined ? curve : deleteCurveNodes(curve, nodes);
    if (next === null) return null;
    curves.push(next);
  }
  if (curves.every((curve, index) => curve === sourceCurves[index])) return path;
  return materializeCurvePath(path, curves);
}

function curveAnchorIndices(
  refs: ReadonlyArray<PathNodeRef>,
  pathIndex: number,
): ReadonlyMap<number, ReadonlySet<number>> {
  const byCurve = new Map<number, Set<number>>();
  for (const ref of refs) {
    if (ref.geometry !== 'curve' || ref.handle !== undefined || ref.pathIndex !== pathIndex) {
      continue;
    }
    const nodes = byCurve.get(ref.polylineIndex) ?? new Set<number>();
    nodes.add(ref.pointIndex);
    byCurve.set(ref.polylineIndex, nodes);
  }
  return byCurve;
}

function materializeCurvePath(
  path: ColoredPath,
  curves: ReadonlyArray<CurveSubpath>,
): ColoredPath | null {
  const polylines: Polyline[] = [];
  for (const [index, curve] of curves.entries()) {
    const existing = path.polylines[index];
    if (curve === path.curves?.[index] && existing !== undefined) {
      polylines.push(existing);
      continue;
    }
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
    if (flattened.kind !== 'ok') return null;
    polylines.push(flattened.polyline);
  }
  return { ...path, curves, polylines };
}

export function materializedPolylineToSpecPoints(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
): ReadonlyArray<Vec2> {
  if (!closed || !hasDuplicateClosingPoint(points)) return points;
  return points.slice(0, -1);
}

const curveBounds = new WeakMap<CurveSubpath, Bounds>();
const polylineBounds = new WeakMap<Polyline, Bounds | null>();

export function boundsForPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    const bounds =
      path.curves === undefined
        ? path.polylines.map(cachedPolylineBounds)
        : path.curves.map(cachedCurveBounds);
    for (const next of bounds) {
      if (next === null) continue;
      minX = Math.min(minX, next.minX);
      minY = Math.min(minY, next.minY);
      maxX = Math.max(maxX, next.maxX);
      maxY = Math.max(maxY, next.maxY);
    }
  }
  return minX === Number.POSITIVE_INFINITY
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : { minX, minY, maxX, maxY };
}

function cachedCurveBounds(curve: CurveSubpath): Bounds {
  const existing = curveBounds.get(curve);
  if (existing !== undefined) return existing;
  const bounds = curveSubpathBounds(curve);
  curveBounds.set(curve, bounds);
  return bounds;
}

function cachedPolylineBounds(polyline: Polyline): Bounds | null {
  const existing = polylineBounds.get(polyline);
  if (existing !== undefined) return existing;
  const bounds = boundsForPolyline(polyline);
  polylineBounds.set(polyline, bounds);
  return bounds;
}

function boundsForPolyline(polyline: Polyline): Bounds | null {
  const first = polyline.points[0];
  if (first === undefined) return null;
  return polyline.points.slice(1).reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y },
  );
}

function deletePolylineNodes(
  polyline: Polyline,
  selectedIndices: ReadonlySet<number>,
): Polyline | null {
  if (selectedIndices.size === 0) return polyline;
  if (!hasSelectedPointInRange(polyline.points.length, selectedIndices)) return polyline;
  if (!polyline.closed) {
    const points = polyline.points.filter((_point, index) => !selectedIndices.has(index));
    return points.length >= 2 ? { ...polyline, points } : null;
  }

  const hasClosingDuplicate = hasDuplicateClosingPoint(polyline.points);
  const sourcePoints = hasClosingDuplicate ? polyline.points.slice(0, -1) : polyline.points;
  const sourceIndicesToDelete = new Set<number>();
  for (const selectedIndex of selectedIndices) {
    if (hasClosingDuplicate && selectedIndex === polyline.points.length - 1) {
      sourceIndicesToDelete.add(0);
    } else {
      sourceIndicesToDelete.add(selectedIndex);
    }
  }
  const points = sourcePoints.filter((_point, index) => !sourceIndicesToDelete.has(index));
  if (points.length < 3) return null;
  const first = points[0];
  return first === undefined ? null : { ...polyline, points: [...points, first] };
}

function hasSelectedPointInRange(
  pointCount: number,
  selectedIndices: ReadonlySet<number>,
): boolean {
  for (const selectedIndex of selectedIndices) {
    if (selectedIndex >= 0 && selectedIndex < pointCount) return true;
  }
  return false;
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function hasDuplicateClosingPoint(points: ReadonlyArray<Vec2>): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined && last !== undefined && pointsEqual(first, last);
}

function groupPathNodeRefsByPolyline(
  refs: ReadonlyArray<PathNodeRef>,
): ReadonlyMap<string, ReadonlyArray<PathNodeRef>> {
  const byPolyline = new Map<string, PathNodeRef[]>();
  for (const ref of refs) {
    const key = pathNodePolylineKey(ref);
    const current = byPolyline.get(key) ?? [];
    current.push(ref);
    byPolyline.set(key, current);
  }
  return byPolyline;
}

function pathNodePolylineKey(ref: Pick<PathNodeRef, 'pathIndex' | 'polylineIndex'>): string {
  return `${ref.pathIndex}:${ref.polylineIndex}`;
}
