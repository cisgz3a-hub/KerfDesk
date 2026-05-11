/**
 * T1-147: pure compound-path role inference + point-in-polygon test
 * extracted from JobCompiler. Pre-T1-147 these two helpers lived
 * inside the 1156-line JobCompiler.ts file and were only exercised
 * via end-to-end compile tests.
 *
 * `inferCompoundRoles` determines the outer/hole/island/open role of
 * each closed contour in a compound path by counting how many other
 * closed contours each one is nested inside. Odd-depth = hole,
 * even-depth (non-zero) = island, depth-0 = outer, open contours
 * stay open. Used by the JobCompiler when flattening a path-geometry
 * to a compound-path representation for the planner.
 *
 * `pointInPointGroup` is the classic ray-cast point-in-polygon test
 * (Jordan curve theorem). Uses `1e-12` to avoid divide-by-zero on
 * horizontal edges. Returns true when `point` is strictly inside
 * `polygon`.
 *
 * Both are pure. Hoisting to a sibling module lets the role-inference
 * rules be tested in isolation (the unit tests in the past required
 * compiling a whole scene through JobCompiler).
 */
import type { Point } from '../types';
import type { ContourRole } from '../geometry/CompoundPath';

/** Shape the helpers need — structurally compatible with `JobCompiler.PointGroup`. */
export interface InferRolesGroup {
  points: readonly Point[];
  closed: boolean;
}

/**
 * Determine the contour role of each point group in a compound path.
 * Open contours stay `open`. Closed contours get classified by how
 * many other closed contours they're nested inside:
 *
 *   - depth 0 (not inside any)   → `outer`
 *   - depth odd (1, 3, 5, ...)   → `hole`
 *   - depth even non-zero (2, 4) → `island`
 *
 * O(n²) over the groups list — each closed group tests its first
 * point against every other closed group. Acceptable because
 * compound paths typically have <10 sub-contours.
 */
export function inferCompoundRoles(groups: ReadonlyArray<InferRolesGroup>): ContourRole[] {
  return groups.map((group, index) => {
    if (!group.closed) return 'open';

    const sample = group.points[0];
    let depth = 0;
    for (let i = 0; i < groups.length; i++) {
      if (i === index) continue;
      const candidate = groups[i];
      if (!candidate.closed || candidate.points.length < 3) continue;
      if (pointInPointGroup(sample, candidate.points)) depth++;
    }

    if (depth % 2 === 1) return 'hole';
    return depth === 0 ? 'outer' : 'island';
  });
}

/**
 * Ray-cast point-in-polygon test. Returns true if `point` is strictly
 * inside `polygon`. Uses the classic Jordan-curve algorithm: count
 * how many polygon edges a horizontal ray from `point` going to +∞
 * crosses; odd-count means inside.
 *
 * The `|| 1e-12` guard avoids divide-by-zero on perfectly horizontal
 * edges where (yj - yi) === 0.
 */
export function pointInPointGroup(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
