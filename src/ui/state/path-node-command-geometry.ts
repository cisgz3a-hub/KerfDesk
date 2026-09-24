import {
  curveNodePoint,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
} from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';

type CurveCommandNode = {
  readonly closed: boolean;
  readonly outgoingKind: PathSegment['kind'] | null;
};

/** Inspect a compact anchor without constructing the duplicate curve graph during rendering. */
export function curveCommandNode(
  path: ColoredPath | undefined,
  ref: PathNodeRef,
): CurveCommandNode | null {
  if (path === undefined || ref.handle !== undefined) return null;
  if (ref.geometry === 'curve') {
    return canonicalCommandNode(path.curves?.[ref.polylineIndex], ref.pointIndex);
  }
  if (path.curves !== undefined || path.polylines.some((line) => line.points.length === 0)) {
    return null;
  }
  const line = path.polylines[ref.polylineIndex];
  if (line?.points[ref.pointIndex] === undefined) return null;
  return {
    closed: line.closed,
    outgoingKind: ref.pointIndex < line.points.length - 1 ? 'line' : null,
  };
}

function canonicalCommandNode(
  curve: CurveSubpath | undefined,
  pointIndex: number,
): CurveCommandNode | null {
  return curve === undefined || curveNodePoint(curve, pointIndex) === null
    ? null
    : { closed: curve.closed, outgoingKind: curve.segments[pointIndex]?.kind ?? null };
}

/** Materialisation belongs inside the user's edit transaction so undo retains the compact source. */
export function curveCommandPath(
  path: ColoredPath,
  refs: ReadonlyArray<PathNodeRef>,
): (ColoredPath & { readonly curves: ReadonlyArray<CurveSubpath> }) | null {
  if (refs.some((ref) => curveCommandNode(path, ref) === null)) return null;
  return { ...path, curves: path.curves ?? path.polylines.map(polylineToCurveSubpath) };
}
