/**
 * T2-15 output-boundary helpers for converting CompoundPath contours to FlatPath.
 */
import {
  contourBounds,
  type CompoundPath,
  type ContourRole,
} from '../geometry/CompoundPath';
import type { FlatPath } from './Job';

export interface CompoundFlatPathOptions {
  readonly powerScale?: number;
  readonly sortForCutting?: boolean;
}

const ROLE_CUT_ORDER: Record<ContourRole, number> = {
  hole: 0,
  island: 1,
  outer: 2,
  open: 3,
};

function coordsFromPoints(points: CompoundPath['contours'][number]['points']): Float64Array {
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    coords[i * 2] = points[i].x;
    coords[i * 2 + 1] = points[i].y;
  }
  return coords;
}

export function flatPathsFromCompoundPath(
  path: CompoundPath,
  options: CompoundFlatPathOptions = {},
): FlatPath[] {
  const powerScale = options.powerScale ?? 1;
  const result: FlatPath[] = [];

  for (let i = 0; i < path.contours.length; i++) {
    const contour = path.contours[i];
    if (contour.points.length < (contour.closed ? 3 : 2)) continue;
    result.push({
      id: `${path.sourceObjectId}:${contour.role}:${i}`,
      coords: coordsFromPoints(contour.points),
      closed: contour.closed,
      direction: contour.winding,
      bounds: contourBounds(contour),
      parentId: path.sourceObjectId,
      compoundId: path.sourceObjectId,
      contourRole: contour.role,
      contourIndex: i,
      powerScale,
    });
  }

  return options.sortForCutting ? orderCompoundFlatPathsForCutting(result) : result;
}

export function orderCompoundFlatPathsForCutting(paths: readonly FlatPath[]): FlatPath[] {
  return paths
    .map((path, index) => ({ path, index }))
    .sort((a, b) => {
      if (a.path.compoundId && a.path.compoundId === b.path.compoundId) {
        const aRole = a.path.contourRole;
        const bRole = b.path.contourRole;
        if (aRole && bRole) {
          const roleDelta = ROLE_CUT_ORDER[aRole] - ROLE_CUT_ORDER[bRole];
          if (roleDelta !== 0) return roleDelta;
        }
      }
      return a.index - b.index;
    })
    .map(entry => entry.path);
}
