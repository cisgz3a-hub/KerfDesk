/**
 * === FILE: /src/geometry/hit-test.ts ===
 *
 * Purpose:    Pure hit testing: given a world-space point, determine
 *             which scene object (if any) is under it.
 *
 *             Algorithm:
 *             1. Iterate objects in reverse (top-most first)
 *             2. Skip invisible objects and locked layers
 *             3. AABB pre-filter (cheap rejection)
 *             4. Geometry-specific precise test
 *
 *             All tests work in LOCAL object space after applying
 *             the inverse transform.
 *
 * Dependencies:
 *   - /src/core/types.ts (Point, AABB)
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/geometry/bounds.ts
 * Last updated: Object selection feature
 */

import { type Point, type Matrix3x2 } from '../core/types';
import { type Scene } from '../core/scene/Scene';
import { type SceneObject, type Geometry } from '../core/scene/SceneObject';
import { type Layer } from '../core/scene/Layer';
import { computeObjectBounds } from './bounds';

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Find the top-most visible, unlocked object under a world-space point.
 *
 * @param worldPoint  Click position in world (mm) coordinates
 * @param scene       The scene to test against
 * @param tolerance   Hit tolerance in world units (mm). Allows clicking
 *                    near thin lines/strokes. Typically 1–3mm depending
 *                    on zoom level. Pass `transform.screenPx(5)` for
 *                    a consistent 5-pixel tolerance.
 * @returns           The hit object, or null if nothing was hit.
 */
export function hitTestPoint(
  worldPoint: Point,
  scene: Scene,
  tolerance: number = 2
): SceneObject | null {
  // Build layer visibility/lock map
  const layerMap = new Map<string, Layer>();
  for (const layer of scene.layers) {
    layerMap.set(layer.id, layer);
  }

  // Iterate in reverse: last drawn = top-most = first hit
  for (let i = scene.objects.length - 1; i >= 0; i--) {
    const obj = scene.objects[i];
    if (!obj.visible || obj.locked) continue;

    const layer = layerMap.get(obj.layerId);
    if (!layer || !layer.visible || layer.locked) continue;

    // AABB pre-filter (expanded by tolerance)
    const bounds = computeObjectBounds(obj);
    if (worldPoint.x < bounds.minX - tolerance ||
        worldPoint.x > bounds.maxX + tolerance ||
        worldPoint.y < bounds.minY - tolerance ||
        worldPoint.y > bounds.maxY + tolerance) {
      continue;
    }

    // Transform world point to object's local space
    const localPoint = worldToLocal(worldPoint, obj.transform);

    // Geometry-specific test
    if (hitTestGeometry(localPoint, obj.geometry, tolerance)) {
      return obj;
    }
  }

  return null;
}

// ─── GEOMETRY HIT TESTS ──────────────────────────────────────────

function hitTestGeometry(
  p: Point,
  geom: Geometry,
  tolerance: number
): boolean {
  switch (geom.type) {
    case 'rect':
      return hitTestRect(p, geom, tolerance);
    case 'ellipse':
      return hitTestEllipse(p, geom, tolerance);
    case 'line':
      return hitTestLine(p, geom.x1, geom.y1, geom.x2, geom.y2, tolerance);
    case 'polygon':
      return hitTestPolygon(p, geom.points, geom.closed, tolerance);
    case 'path':
      return hitTestPath(p, geom, tolerance);
    case 'text':
      return hitTestTextBounds(p, geom);
    case 'image':
      return hitTestImageBounds(p, geom);
  }
}

// ─── RECT ────────────────────────────────────────────────────────

function hitTestRect(
  p: Point,
  geom: { x: number; y: number; width: number; height: number },
  tolerance: number
): boolean {
  // Interior hit (for fill)
  if (p.x >= geom.x && p.x <= geom.x + geom.width &&
      p.y >= geom.y && p.y <= geom.y + geom.height) {
    return true;
  }

  // Stroke hit (for cut/score — near the edges)
  const edges: [number, number, number, number][] = [
    [geom.x, geom.y, geom.x + geom.width, geom.y],
    [geom.x + geom.width, geom.y, geom.x + geom.width, geom.y + geom.height],
    [geom.x + geom.width, geom.y + geom.height, geom.x, geom.y + geom.height],
    [geom.x, geom.y + geom.height, geom.x, geom.y],
  ];

  for (const [x1, y1, x2, y2] of edges) {
    if (distToSegment(p, x1, y1, x2, y2) <= tolerance) return true;
  }

  return false;
}

// ─── ELLIPSE ─────────────────────────────────────────────────────

function hitTestEllipse(
  p: Point,
  geom: { cx: number; cy: number; rx: number; ry: number },
  tolerance: number
): boolean {
  // Normalized distance from center: (dx/rx)² + (dy/ry)² ≤ 1 = inside
  const dx = p.x - geom.cx;
  const dy = p.y - geom.cy;
  const rx = Math.abs(geom.rx);
  const ry = Math.abs(geom.ry);
  if (rx === 0 || ry === 0) return false;

  const norm = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);

  // Interior hit
  if (norm <= 1) return true;

  // Stroke hit: check if normalized distance is near 1
  // Approximate tolerance in normalized space
  const tolNorm = tolerance / Math.min(rx, ry);
  return norm <= (1 + tolNorm) * (1 + tolNorm);
}

// ─── LINE ────────────────────────────────────────────────────────

function hitTestLine(
  p: Point,
  x1: number, y1: number,
  x2: number, y2: number,
  tolerance: number
): boolean {
  return distToSegment(p, x1, y1, x2, y2) <= tolerance;
}

// ─── POLYGON ─────────────────────────────────────────────────────

function hitTestPolygon(
  p: Point,
  points: Point[],
  closed: boolean,
  tolerance: number
): boolean {
  if (points.length < 2) return false;

  // If closed, test interior (point-in-polygon)
  if (closed && points.length >= 3) {
    if (pointInPolygon(p, points)) return true;
  }

  // Stroke hit: test distance to each edge
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegment(p, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y) <= tolerance) {
      return true;
    }
  }

  // Closing edge
  if (closed && points.length >= 3) {
    const last = points[points.length - 1];
    const first = points[0];
    if (distToSegment(p, last.x, last.y, first.x, first.y) <= tolerance) {
      return true;
    }
  }

  return false;
}

// ─── PATH ────────────────────────────────────────────────────────

function hitTestPath(
  p: Point,
  geom: { subPaths: Array<{ segments: Array<any>; closed: boolean }> },
  tolerance: number
): boolean {
  for (const sub of geom.subPaths) {
    // Convert path segments to point list for edge testing
    const points = pathSegmentsToPoints(sub.segments);
    if (hitTestPolygon(p, points, sub.closed, tolerance)) return true;
  }
  return false;
}

function pathSegmentsToPoints(segments: any[]): Point[] {
  const points: Point[] = [];
  for (const seg of segments) {
    switch (seg.type) {
      case 'move':
      case 'line':
        points.push({ x: seg.to.x, y: seg.to.y });
        break;
      case 'cubic': {
        // Sample the bezier at intervals for hit testing
        const prev = points[points.length - 1] || { x: 0, y: 0 };
        for (let t = 0.25; t <= 1; t += 0.25) {
          points.push(cubicAt(prev, seg.cp1, seg.cp2, seg.to, t));
        }
        break;
      }
      case 'quadratic': {
        const prev = points[points.length - 1] || { x: 0, y: 0 };
        for (let t = 0.25; t <= 1; t += 0.25) {
          points.push(quadraticAt(prev, seg.cp, seg.to, t));
        }
        break;
      }
    }
  }
  return points;
}

// ─── TEXT / IMAGE (BOUNDING BOX ONLY) ────────────────────────────

function hitTestTextBounds(
  p: Point,
  geom: { text: string; fontSize: number }
): boolean {
  const w = geom.text.length * geom.fontSize * 0.6;
  const h = geom.fontSize;
  return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
}

function hitTestImageBounds(
  p: Point,
  geom: { originalWidth: number; originalHeight: number; cropWidth: number; cropHeight: number }
): boolean {
  const w = geom.cropWidth || geom.originalWidth;
  const h = geom.cropHeight || geom.originalHeight;
  return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
}

// ─── MATH HELPERS ────────────────────────────────────────────────

/**
 * Distance from point p to line segment (x1,y1)→(x2,y2).
 */
function distToSegment(
  p: Point,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (point)
    return Math.sqrt((p.x - x1) ** 2 + (p.y - y1) ** 2);
  }

  // Project p onto the line, clamped to [0,1]
  let t = ((p.x - x1) * dx + (p.y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

/**
 * Ray-casting point-in-polygon.
 */
function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    if ((yi > p.y) !== (yj > p.y)) {
      const intersectX = xj + ((p.y - yj) / (yi - yj)) * (xi - xj);
      if (p.x < intersectX) inside = !inside;
    }
  }

  return inside;
}

/**
 * Inverse affine transform: world → local.
 */
function worldToLocal(p: Point, m: Matrix3x2): Point {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-10) return p; // Degenerate transform

  const px = p.x - m.tx;
  const py = p.y - m.ty;

  return {
    x: (m.d * px - m.c * py) / det,
    y: (-m.b * px + m.a * py) / det,
  };
}

/**
 * Evaluate cubic bezier at parameter t.
 */
function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * Evaluate quadratic bezier at parameter t.
 */
function quadraticAt(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}
