/**
 * Boolean ops (union / difference / intersection) via polygon-clipping.
 * Curves are flattened to polylines before clipping.
 */

import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import type { SceneObject } from '../core/scene/SceneObject';
import type { PathGeometry } from '../core/scene/SceneObject';

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
    const multi: MultiPolygon = [];
    for (const sp of geom.subPaths || []) {
      const ring: Ring = [];
      let cx = 0;
      let cy = 0;

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
          if (ring.length > 0) {
            ring.push([ring[0][0], ring[0][1]]);
          }
        }
      }

      if (ring.length >= 4) {
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push([ring[0][0], ring[0][1]]);
        }
        multi.push([ring]);
      }
    }

    return multi.length > 0 ? multi : null;
  }

  if (geom.type === 'polygon') {
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

export function booleanOperation(objA: SceneObject, objB: SceneObject, op: BooleanOp): PathGeometry | null {
  const polyA = objectToPolygon(objA);
  const polyB = objectToPolygon(objB);

  if (!polyA || !polyB) return null;

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

  if (!result || result.length === 0) return null;

  const pathGeom = polygonToPathGeometry(result);
  if (pathGeom.subPaths.length === 0) return null;

  return pathGeom;
}
