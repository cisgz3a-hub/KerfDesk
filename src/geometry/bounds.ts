/**
 * === FILE: /src/geometry/bounds.ts ===
 *
 * Purpose:    Pure functions for computing bounding boxes from
 *             Scene objects and SimulationResult. Used by the
 *             "Zoom to Fit" feature and frustum culling.
 *
 *             Hierarchy of fit targets:
 *             1. Simulation bounds (if simulation exists, shows toolpaths)
 *             2. Scene content bounds (union of all visible objects)
 *             3. Bed bounds (fallback: the machine workspace)
 *
 * Dependencies:
 *   - /src/core/types.ts (AABB, Point)
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/plan/Simulation.ts
 * Last updated: Relocated from /src/ui/bounds.ts → /src/geometry/bounds.ts
 */

import {
  type AABB, type Point,
  emptyAABB, expandAABB, mergeAABB,
} from '../core/types';
import { type Scene } from '../core/scene/Scene';
import { type SceneObject, type Geometry, type TextGeometry } from '../core/scene/SceneObject';
import { type SimulationResult } from '../core/plan/Simulation';
import { measureTextGeometrySize } from './textCanvasDraw';

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Compute the best bounding box to fit the viewport to.
 *
 * Priority:
 *   1. Simulation bounds (if provided and non-empty)
 *   2. Scene content bounds (visible objects)
 *   3. Bed bounds (canvas dimensions)
 */
export function computeFitBounds(
  scene: Scene,
  simulation: SimulationResult | null
): AABB {
  // 1. Try simulation bounds
  if (simulation && simulation.frames.length > 1) {
    const simBounds = computeSimulationBounds(simulation);
    if (isValidBounds(simBounds)) return simBounds;
  }

  // 2. Try scene content bounds
  const contentBounds = computeSceneBounds(scene);
  if (isValidBounds(contentBounds)) return contentBounds;

  // 3. Fall back to bed
  return {
    minX: 0,
    minY: 0,
    maxX: scene.canvas.width,
    maxY: scene.canvas.height,
  };
}

// ─── SCENE BOUNDS ────────────────────────────────────────────────

/**
 * Compute the union AABB of all visible objects in the scene.
 * Applies each object's transform to get world-space bounds.
 */
export function computeSceneBounds(scene: Scene): AABB {
  let bounds = emptyAABB();

  const visibleLayerIds = new Set(
    scene.layers.filter(l => l.visible).map(l => l.id)
  );

  for (const obj of scene.objects) {
    if (!obj.visible) continue;
    if (!visibleLayerIds.has(obj.layerId)) continue;

    const objBounds = computeObjectBounds(obj);
    if (isValidBounds(objBounds)) {
      bounds = mergeAABB(bounds, objBounds);
    }
  }

  return bounds;
}

// T1-109: canonical "what will burn" bounds. Same predicate the
// JobCompiler's getOutputLayers (l.visible && l.output) +
// objectsOnLayerInSceneOrder (o.visible) apply, so frame motion
// derived from these bounds matches the compiled job's geometry.
//
// computeSceneBounds is intentionally separate — viewport rendering
// (SceneRenderer) and SVG import positioning (SvgToScene) need full
// scene bounds including guide / reference layers (output: false).
export function computeOutputBounds(scene: Scene): AABB {
  let bounds = emptyAABB();

  const outputLayerIds = new Set(
    scene.layers.filter(l => l.visible && l.output).map(l => l.id)
  );

  for (const obj of scene.objects) {
    if (!obj.visible) continue;
    if (!outputLayerIds.has(obj.layerId)) continue;

    const objBounds = computeObjectBounds(obj);
    if (isValidBounds(objBounds)) {
      bounds = mergeAABB(bounds, objBounds);
    }
  }

  return bounds;
}

/**
 * Compute world-space AABB for a single SceneObject.
 * Applies the object's transform matrix to geometry bounds.
 */
export function computeObjectBounds(obj: SceneObject): AABB {
  const localPoints = getGeometryCorners(obj.geometry);
  if (localPoints.length === 0) return emptyAABB();

  let bounds = emptyAABB();
  const t = obj.transform;

  for (const p of localPoints) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    // Apply affine transform
    const wx = t.a * p.x + t.c * p.y + t.tx;
    const wy = t.b * p.x + t.d * p.y + t.ty;
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
    bounds = expandAABB(bounds, wx, wy);
  }

  return bounds;
}

// ─── SIMULATION BOUNDS ───────────────────────────────────────────

/**
 * Compute AABB from simulation frames.
 * Includes all positions the laser head visits.
 */
export function computeSimulationBounds(result: SimulationResult): AABB {
  let bounds = emptyAABB();

  for (const frame of result.frames) {
    if (frame.moveType === 'rapid' || frame.moveType === 'linear') {
      bounds = expandAABB(bounds, frame.x, frame.y);
    }
  }

  return bounds;
}

// ─── GEOMETRY CORNERS ────────────────────────────────────────────

/**
 * Get the local-space corner/control points of a geometry.
 * Used for AABB computation. Returns enough points to
 * enclose the geometry (not necessarily exact bounds for curves).
 */
function getGeometryCorners(geom: Geometry): Point[] {
  switch (geom.type) {
    case 'rect':
      return [
        { x: geom.x, y: geom.y },
        { x: geom.x + geom.width, y: geom.y },
        { x: geom.x + geom.width, y: geom.y + geom.height },
        { x: geom.x, y: geom.y + geom.height },
      ];

    case 'ellipse':
      return [
        { x: geom.cx - geom.rx, y: geom.cy - geom.ry },
        { x: geom.cx + geom.rx, y: geom.cy - geom.ry },
        { x: geom.cx + geom.rx, y: geom.cy + geom.ry },
        { x: geom.cx - geom.rx, y: geom.cy + geom.ry },
      ];

    case 'line':
      return [
        { x: geom.x1, y: geom.y1 },
        { x: geom.x2, y: geom.y2 },
      ];

    case 'polygon':
      return [...geom.points];

    case 'path': {
      const pts: Point[] = [];
      for (const sub of geom.subPaths) {
        for (const seg of sub.segments) {
          switch (seg.type) {
            case 'move':
            case 'line':
              pts.push(seg.to); break;
            case 'cubic':
              pts.push(seg.cp1, seg.cp2, seg.to); break;
            case 'quadratic':
              pts.push(seg.cp, seg.to); break;
          }
        }
      }
      return pts;
    }

    case 'text': {
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        if (ctx) {
          const { width, height } = measureTextGeometrySize(ctx, geom as TextGeometry);
          return [
            { x: 0, y: 0 },
            { x: width, y: height },
          ];
        }
      }
      return [
        { x: 0, y: 0 },
        { x: geom.text.length * geom.fontSize * 0.6, y: geom.fontSize },
      ];
    }

    case 'image': {
      // Match SceneRenderer / import: pixel dims at 96 DPI → mm local space
      const dpi = 96;
      const w = ((geom.cropWidth || geom.originalWidth) / dpi) * 25.4;
      const h = ((geom.cropHeight || geom.originalHeight) / dpi) * 25.4;
      return [
        { x: 0, y: 0 },
        { x: w, y: h },
      ];
    }
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────

function isValidBounds(aabb: AABB): boolean {
  return isFinite(aabb.minX) && isFinite(aabb.maxX) &&
         isFinite(aabb.minY) && isFinite(aabb.maxY) &&
         aabb.maxX > aabb.minX && aabb.maxY > aabb.minY;
}
