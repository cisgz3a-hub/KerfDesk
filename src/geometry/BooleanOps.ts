/**
 * Boolean ops (union / difference / intersection) via polygon-clipping.
 * Curves are flattened to polylines before clipping.
 */

import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import type { CompoundPath } from '../core/geometry/CompoundPath';
import type { SceneObject } from '../core/scene/SceneObject';
import type { PathGeometry } from '../core/scene/SceneObject';
import { assertFeature } from '../entitlements';
import { compoundPathToMultiPolygon, multiPolygonToCompoundPath } from './CompoundPathPolygon';

type Coord = [number, number];
type Ring = Coord[];

function flattenCubicBezier(
  x0: number, y0: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  x: number, y: number,
  steps: number = 12
): Coord[] {
  const pts: Coord[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const px = mt * mt * mt * x0 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x;
    const py = mt * mt * mt * y0 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y;
    pts.push([px, py]);
  }
  return pts;
}

function flattenQuadraticBezier(
  x0: number, y0: number,
  cpx: number, cpy: number,
  x: number, y: number,
  steps: number = 10
): Coord[] {
  const pts: Coord[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const px = mt * mt * x0 + 2 * mt * t * cpx + t * t * x;
    const py = mt * mt * y0 + 2 * mt * t * cpy + t * t * y;
    pts.push([px, py]);
  }
  return pts;
}

/**
 * T1-36: ray-cast point-in-ring (even-odd fill rule). The ring is a
 * closed Coord[] where the last point equals the first; we ignore the
 * duplicate. Robust enough for the containment-tree we only consult
 * once per ring at offset/clip time.
 */
function pointInRing(p: Coord, ring: Ring): boolean {
  let inside = false;
  const n = ring.length - 1; // last point duplicates the first
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > p[1]) !== (yj > p[1]) &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringSignedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

/**
 * T1-36: group flat list of rings into a MultiPolygon by even-odd
 * containment depth. Depth-0 rings are outers of new polygons. Depth-1
 * rings are attached as holes to the depth-0 ring that contains them.
 * Depth ≥ 2 rings (islands inside holes) start new polygons whose own
 * holes are picked up at depth + 1 = 3, etc.
 *
 * Pre-T1-36 each subpath became its own single-ring polygon, so a
 * compound-path donut lost its hole at offset / boolean time.
 */
function groupRingsByContainment(rings: Ring[]): MultiPolygon {
  const depths = rings.map(r => {
    const sample = r[0];
    let d = 0;
    for (let j = 0; j < rings.length; j++) {
      if (rings[j] === r) continue;
      if (pointInRing(sample, rings[j])) d++;
    }
    return d;
  });

  // For each ring whose depth is even, find its immediate parent (the
  // smallest ring that contains it, exclusive) — null for depth 0.
  // Holes (odd depth) attach to the nearest enclosing even-depth ring.
  const result: MultiPolygon = [];
  // Map each even-depth ring (an outer/island) to the index of its
  // entry in `result`.
  const outerIndex = new Map<number, number>();
  for (let i = 0; i < rings.length; i++) {
    if (depths[i] % 2 === 0) {
      outerIndex.set(i, result.length);
      result.push([rings[i]]);
    }
  }
  for (let i = 0; i < rings.length; i++) {
    if (depths[i] % 2 === 1) {
      // Hole — find the smallest containing even-depth ring (i.e. the
      // one with the largest depth that is still less than this ring's
      // depth and contains the sample point).
      let bestIdx = -1;
      let bestDepth = -1;
      const sample = rings[i][0];
      for (let j = 0; j < rings.length; j++) {
        if (j === i) continue;
        if (depths[j] !== depths[i] - 1) continue;
        if (depths[j] <= bestDepth) continue;
        if (!pointInRing(sample, rings[j])) continue;
        bestIdx = j;
        bestDepth = depths[j];
      }
      if (bestIdx >= 0) {
        const targetPolyIdx = outerIndex.get(bestIdx);
        if (targetPolyIdx != null) result[targetPolyIdx].push(rings[i]);
      } else {
        // Orphan hole (no containing outer found) — fall back to treating
        // it as its own outer so geometry isn't lost.
        result.push([rings[i]]);
      }
    }
  }
  return result;
}

/**
 * Convert a SceneObject to polygon-clipping geometry (Polygon or MultiPolygon).
 * Applies the object's transform to all points.
 */
export function objectToPolygon(obj: SceneObject): MultiPolygon | null {
  const t = obj.transform;
  const transformPoint = (x: number, y: number): Coord => [
    x * t.a + y * t.c + t.tx,
    x * t.b + y * t.d + t.ty,
  ];

  const geom = obj.geometry;

  if (geom.type === 'rect') {
    const x = geom.x || 0;
    const y = geom.y || 0;
    const w = geom.width;
    const h = geom.height;
    const ring: Ring = [
      transformPoint(x, y),
      transformPoint(x + w, y),
      transformPoint(x + w, y + h),
      transformPoint(x, y + h),
      transformPoint(x, y),
    ];
    return [[ring]];
  }

  if (geom.type === 'ellipse') {
    const cx = geom.cx;
    const cy = geom.cy;
    const rx = geom.rx;
    const ry = geom.ry;
    const steps = 32;
    const ring: Ring = [];
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ring.push(transformPoint(
        cx + rx * Math.cos(angle),
        cy + ry * Math.sin(angle)
      ));
    }
    return [[ring]];
  }

  if (geom.type === 'path') {
    // T1-36: collect every subpath's ring up front, then group by
    // containment depth so outer + hole subpaths end up in the same
    // polygon (instead of each becoming a separate single-ring polygon
    // and dropping their hole semantics). One level of nesting is the
    // common case (donut, gear teeth, lettering with closed loops);
    // depth-2+ become island outers per even-odd nesting.
    const rawRings: Ring[] = [];
    for (const sp of geom.subPaths || []) {
      const ring: Ring = [];
      let cx = 0;
      let cy = 0;
      let sawCloseSegment = false;

      for (const seg of sp.segments) {
        if (seg.type === 'move') {
          cx = seg.to.x;
          cy = seg.to.y;
          ring.push(transformPoint(cx, cy));
        } else if (seg.type === 'line') {
          cx = seg.to.x;
          cy = seg.to.y;
          ring.push(transformPoint(cx, cy));
        } else if (seg.type === 'cubic') {
          const pts = flattenCubicBezier(cx, cy, seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y);
          for (const p of pts) ring.push(transformPoint(p[0], p[1]));
          cx = seg.to.x;
          cy = seg.to.y;
        } else if (seg.type === 'quadratic') {
          const pts = flattenQuadraticBezier(cx, cy, seg.cp.x, seg.cp.y, seg.to.x, seg.to.y);
          for (const p of pts) ring.push(transformPoint(p[0], p[1]));
          cx = seg.to.x;
          cy = seg.to.y;
        } else if (seg.type === 'close') {
          sawCloseSegment = true;
          if (ring.length > 0) {
            ring.push([ring[0][0], ring[0][1]]);
          }
        }
      }

      const isClosedRing = ring.length >= 2
        && ring[0][0] === ring[ring.length - 1][0]
        && ring[0][1] === ring[ring.length - 1][1];
      const isClosedSubPath = sp.closed === true || sawCloseSegment || isClosedRing;

      if (isClosedSubPath && ring.length >= 4) {
        if (!isClosedRing) {
          ring.push([ring[0][0], ring[0][1]]);
        }
        rawRings.push(ring);
      }
    }

    if (rawRings.length === 0) return null;
    return groupRingsByContainment(rawRings);
  }

  if (geom.type === 'polygon') {
    if (geom.closed !== true) return null;
    const pts = geom.points || [];
    if (pts.length < 3) return null;
    const ring: Ring = pts.map(p => transformPoint(p.x, p.y));
    ring.push([ring[0][0], ring[0][1]]);
    return [[ring]];
  }

  return null;
}

/**
 * Convert clipping result to a path geometry in world space (identity transform on the object).
 */
export function polygonToPathGeometry(multiPolygon: MultiPolygon): PathGeometry {
  const subPaths: PathGeometry['subPaths'] = [];

  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;

      let coords = ring.map(c => [c[0], c[1]] as Coord);
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (coords.length >= 2 && first[0] === last[0] && first[1] === last[1]) {
        coords = coords.slice(0, -1);
      }
      if (coords.length < 3) continue;

      const segments: PathGeometry['subPaths'][0]['segments'] = [
        { type: 'move', to: { x: coords[0][0], y: coords[0][1] } },
      ];

      for (let i = 1; i < coords.length; i++) {
        segments.push({
          type: 'line',
          to: { x: coords[i][0], y: coords[i][1] },
        });
      }

      segments.push({ type: 'close' });
      subPaths.push({ segments, closed: true });
    }
  }

  return {
    type: 'path',
    subPaths,
  };
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';

function runBooleanOperation(polyA: MultiPolygon, polyB: MultiPolygon, op: BooleanOp): MultiPolygon | null {
  let result: MultiPolygon;

  try {
    switch (op) {
      case 'union':
        result = polygonClipping.union(polyA, polyB);
        break;
      case 'subtract':
        result = polygonClipping.difference(polyA, polyB);
        break;
      case 'intersect':
        result = polygonClipping.intersection(polyA, polyB);
        break;
    }
  } catch (e) {
    console.error('Boolean operation failed:', e);
    return null;
  }

  return result && result.length > 0 ? result : null;
}

export function booleanCompoundPaths(
  pathA: CompoundPath,
  pathB: CompoundPath,
  op: BooleanOp,
): CompoundPath | null {
  assertFeature('boolean_ops');

  const result = runBooleanOperation(
    compoundPathToMultiPolygon(pathA),
    compoundPathToMultiPolygon(pathB),
    op,
  );
  if (!result) return null;

  const compound = multiPolygonToCompoundPath(
    result,
    `${pathA.sourceObjectId}-${op}-${pathB.sourceObjectId}`,
    pathA.fillRule,
  );
  return compound.contours.length > 0 ? compound : null;
}

export function booleanOperation(objA: SceneObject, objB: SceneObject, op: BooleanOp): PathGeometry | null {
  // T1-78 Phase 2a: enforcement-style call site → assertFeature.
  // Throws EntitlementError carrying the feature name; the previous
  // ad-hoc `new Error('Boolean operations require a Pro license')`
  // path is gone.
  assertFeature('boolean_ops');
  const polyA = objectToPolygon(objA);
  const polyB = objectToPolygon(objB);

  if (!polyA || !polyB) return null;

  const result = runBooleanOperation(polyA, polyB, op);
  if (!result) return null;

  const pathGeom = polygonToPathGeometry(result);
  if (pathGeom.subPaths.length === 0) return null;

  return pathGeom;
}
