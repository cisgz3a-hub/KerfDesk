import { EndType, FillRule, inflatePathsD, JoinType, unionD, type PathsD } from 'clipper2-ts';
import type { Polyline } from '../scene';
import {
  isClosedPolygon,
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
} from './vector-path-tools';

const PRECISION_DECIMALS = 3;

/** Materialize a round SVG-style centerline stroke as closed filled regions. */
export function roundStrokeOutline(
  polylines: ReadonlyArray<Polyline>,
  strokeWidthMm: number,
): ReadonlyArray<Polyline> | null {
  if (!(strokeWidthMm > 0) || !Number.isFinite(strokeWidthMm)) return null;
  const open: PathsD = [];
  const closed: PathsD = [];
  for (const polyline of polylines) {
    if (polyline.points.length < 2) continue;
    (polyline.closed ? closed : open).push(polylineToPathD(polyline));
  }
  const outlined = tryVectorOp(() => {
    const radiusMm = strokeWidthMm / 2;
    const inflated = [
      ...inflatePathsD(open, radiusMm, JoinType.Round, EndType.Round, 2, PRECISION_DECIMALS),
      ...inflatePathsD(closed, radiusMm, JoinType.Round, EndType.Joined, 2, PRECISION_DECIMALS),
    ];
    return unionD(inflated, [], FillRule.NonZero, PRECISION_DECIMALS);
  });
  if (outlined.kind === 'error') return null;
  return outlined.value.map(pathDToPolyline).filter(isClosedPolygon);
}
