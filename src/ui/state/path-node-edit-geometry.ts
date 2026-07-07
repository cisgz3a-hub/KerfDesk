import type { Bounds, ColoredPath, Polyline, Vec2 } from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';

export function editPathsNodesByDelta(
  paths: ReadonlyArray<ColoredPath>,
  refs: ReadonlyArray<PathNodeRef>,
  dx: number,
  dy: number,
): { readonly paths: ReadonlyArray<ColoredPath> } | null {
  let changed = false;
  const refKeys = new Set(refs.map(pathNodeRefKey));
  const nextPaths = paths.map((path, pathIndex) => ({
    ...path,
    polylines: path.polylines.map((polyline, polylineIndex) => ({
      ...polyline,
      points: polyline.points.map((point, pointIndex) => {
        if (!refKeys.has(pathNodeRefKey({ objectId: '', pathIndex, polylineIndex, pointIndex }))) {
          return point;
        }
        changed = true;
        const nextPoint = { x: point.x + dx, y: point.y + dy };
        return nextPoint;
      }),
    })),
  }));
  return changed ? { paths: nextPaths } : null;
}

export function deletePathsNodes(
  paths: ReadonlyArray<ColoredPath>,
  refs: ReadonlyArray<PathNodeRef>,
): { readonly paths: ReadonlyArray<ColoredPath> } | null {
  let changed = false;
  let invalid = false;
  const refsByPolyline = groupPathNodeRefsByPolyline(refs);
  const nextPaths = paths.map((path, pathIndex) => ({
    ...path,
    polylines: path.polylines.map((polyline, polylineIndex) => {
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
      return edited;
    }),
  }));
  if (invalid || !changed) return null;
  return { paths: nextPaths };
}

// Current local-space position of a single node, or null if the ref is out of
// range. Used to turn an absolute drag target into the delta applied to the
// whole selected-node set (audit C6).
export function pathNodePoint(paths: ReadonlyArray<ColoredPath>, ref: PathNodeRef): Vec2 | null {
  return paths[ref.pathIndex]?.polylines[ref.polylineIndex]?.points[ref.pointIndex] ?? null;
}

export function materializedPolylineToSpecPoints(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
): ReadonlyArray<Vec2> {
  if (!closed || !hasDuplicateClosingPoint(points)) return points;
  return points.slice(0, -1);
}

export function boundsForPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  const points = paths.flatMap((path) =>
    path.polylines.flatMap((polyline: Polyline) => polyline.points),
  );
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
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

function pathNodeRefKey(ref: Omit<PathNodeRef, 'objectId'> | PathNodeRef): string {
  return `${ref.pathIndex}:${ref.polylineIndex}:${ref.pointIndex}`;
}

function pathNodePolylineKey(ref: Pick<PathNodeRef, 'pathIndex' | 'polylineIndex'>): string {
  return `${ref.pathIndex}:${ref.polylineIndex}`;
}
