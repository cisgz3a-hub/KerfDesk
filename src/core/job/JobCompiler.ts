/**
 * === FILE: /src/core/job/JobCompiler.ts ===
 * 
 * Purpose:    Compiles a Scene into a Job. This is the bridge between
 *             the design world (objects, layers, transforms) and the
 *             manufacturing world (operations, flat paths, settings).
 *             After this step, the scene graph is no longer needed.
 * 
 * Pipeline:   Scene → [compileJob()] → Job
 * 
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/Layer.ts
 *   - /src/core/job/Job.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { type Point, type AABB, emptyAABB, mergeAABB, generateId } from '../types';
import { type Scene, getOutputLayers, getObjectsByLayer } from '../scene/Scene';
import { type SceneObject, type Geometry, type ImageGeometry } from '../scene/SceneObject';
import { type Layer, sortLayersByProcessingOrder } from '../scene/Layer';
import {
  type Job, type Operation, type OperationType, type OperationGeometry,
  type ResolvedLaserSettings, type FlatPath, type ProcessedBitmap,
  createEmptyJob, flatPathFromPoints,
} from './Job';

// ─── MAIN COMPILER ───────────────────────────────────────────────

export function compileJob(scene: Scene): Job {
  const job = createEmptyJob(scene.metadata.name, scene.id);
  const outputLayers = sortLayersByProcessingOrder(getOutputLayers(scene));

  let totalObjects = 0;

  for (const layer of outputLayers) {
    const objects = getObjectsByLayer(scene, layer.id);
    if (objects.length === 0) continue;

    // Raster layers: one operation per image (not per layer)
    if (layer.settings.mode === 'image') {
      for (const obj of objects) {
        if (!obj.visible || obj.geometry.type !== 'image') continue;
        const imgOp = compileOperation(layer, [obj]);
        if (imgOp) {
          job.operations.push(imgOp);
          job.bounds = mergeAABB(job.bounds, imgOp.bounds);
          totalObjects++;
        }
      }
      continue;
    }

    const operation = compileOperation(layer, objects);
    if (operation) {
      job.operations.push(operation);
      job.bounds = mergeAABB(job.bounds, operation.bounds);
      totalObjects += objects.length;
    }
  }

  job.metadata.objectCount = totalObjects;
  job.metadata.layerCount = job.operations.length;

  // Pass start position from scene to job for G-code footer
  if ((scene as any).startPosition) {
    job.metadata.startPositionX = (scene as any).startPosition.x;
    job.metadata.startPositionY = (scene as any).startPosition.y;
  }

  return job;
}

// ─── COMPILE SINGLE OPERATION ────────────────────────────────────

function compileOperation(layer: Layer, objects: SceneObject[]): Operation | null {
  const type = mapModeToType(layer.settings.mode);
  const settings = resolveSettings(layer);
  const geometry = compileGeometry(type, objects);

  if (!geometry) return null;

  // Calculate operation bounds
  let bounds = emptyAABB();
  if (geometry.type === 'vector' || geometry.type === 'fill') {
    for (const path of geometry.paths) {
      bounds = mergeAABB(bounds, path.bounds);
    }
  } else if (geometry.type === 'raster') {
    const bm = geometry.bitmap;
    bounds = {
      minX: bm.position.x,
      minY: bm.position.y,
      maxX: bm.position.x + bm.physicalWidth,
      maxY: bm.position.y + bm.physicalHeight,
    };
  }

  return {
    id: generateId(),
    layerId: layer.id,
    layerName: layer.name,
    layerColor: layer.color,
    order: layer.order,
    type,
    settings,
    geometry,
    bounds,
  };
}

// ─── MODE MAPPING ────────────────────────────────────────────────

function mapModeToType(mode: import('../scene/Layer').LayerMode): OperationType {
  switch (mode) {
    case 'cut':     return 'cut';
    case 'engrave': return 'engrave';
    case 'score':   return 'score';
    case 'image':   return 'raster';
  }
}

// ─── RESOLVE SETTINGS ────────────────────────────────────────────
/**
 * Convert Layer's LaserSettings into fully resolved ResolvedLaserSettings.
 * No nulls, no defaults, no conditional logic downstream.
 */
function resolveSettings(layer: Layer): ResolvedLaserSettings {
  const s = layer.settings;
  return {
    powerMin: Math.max(0, Math.min(100, s.power.min)),
    powerMax: Math.max(0, Math.min(100, s.power.max)),
    speed: Math.max(1, s.speed),
    passes: Math.max(1, Math.min(99, s.passes)),
    zStepPerPass: s.zStepPerPass,

    fillInterval: s.fill.enabled ? Math.max(0.01, s.fill.interval) : 0,
    fillAngle: s.fill.angle % 360,
    fillBiDirectional: s.fill.biDirectional,
    overscanning: Math.max(0, s.fill.overscanning),

    overcut: Math.max(0, s.cut.overcut),
    leadIn: Math.max(0, s.cut.leadIn),
    tabCount: Math.max(0, Math.floor(s.cut.tabCount)),
    tabWidth: Math.max(0, s.cut.tabWidth),
    insideFirst: s.cut.insideFirst,

    airAssist: s.airAssist,
  };
}

// ─── COMPILE GEOMETRY ────────────────────────────────────────────

function compileGeometry(
  type: OperationType,
  objects: SceneObject[]
): OperationGeometry | null {
  if (type === 'raster') {
    // Process image objects into raster operations
    for (const obj of objects) {
      if (!obj.visible) continue;
      if (obj.geometry.type !== 'image') continue;

      const geom = obj.geometry;
      const dpi = 254; // Default raster resolution
      const scaleX = Math.abs(obj.transform.a) || 1;
      const scaleY = Math.abs(obj.transform.d) || 1;
      const physicalWidth = ((geom.originalWidth / 96) * 25.4) * scaleX;
      const physicalHeight = ((geom.originalHeight / 96) * 25.4) * scaleY;

      // Create a simple 8-bit grayscale bitmap from the image
      // For now, create a placeholder bitmap — actual image processing
      // (brightness, contrast, dithering) will be added later
      let bitmapWidth: number;
      let bitmapHeight: number;
      let data: Uint8Array;

      const pixelData = (geom as ImageGeometry).adjustedData || geom.grayscaleData;
      if (pixelData && geom.grayscaleWidth && geom.grayscaleHeight) {
        bitmapWidth = geom.grayscaleWidth;
        bitmapHeight = geom.grayscaleHeight;
        data = new Uint8Array(bitmapWidth * bitmapHeight);
        for (let i = 0; i < pixelData.length; i++) {
          data[i] = 255 - pixelData[i];
        }
      } else {
        bitmapWidth = Math.round(physicalWidth * (dpi / 25.4));
        bitmapHeight = Math.round(physicalHeight * (dpi / 25.4));
        data = new Uint8Array(bitmapWidth * bitmapHeight);
        data.fill(128);
      }

      const bitmap: ProcessedBitmap = {
        width: bitmapWidth,
        height: bitmapHeight,
        dpi,
        mode: '8bit',
        data,
        physicalWidth,
        physicalHeight,
        position: {
          x: obj.transform.tx,
          y: obj.transform.ty,
        },
        pipeline: {
          brightness: 0,
          contrast: 0,
          gamma: 1.0,
          ditheringMode: 'none',
          inverted: false,
        },
      };

      return { type: 'raster', bitmap };
    }
    return null;
  }

  const paths: FlatPath[] = [];

  for (const obj of objects) {
    if (!obj.visible) continue;
    const flatPaths = flattenObject(obj);
    paths.push(...flatPaths);
  }

  if (paths.length === 0) return null;

  if (type === 'engrave') {
    return { type: 'fill', paths };
  }
  return { type: 'vector', paths };
}

// ─── FLATTEN OBJECT TO FLAT PATHS ────────────────────────────────
/**
 * Converts a SceneObject (with transform) into FlatPath(s)
 * in world coordinates. Strips away all scene graph overhead.
 */
function flattenObject(obj: SceneObject): FlatPath[] {
  const points = geometryToPoints(obj.geometry);
  if (points.length === 0) return [];

  // Apply object transform to all points
  const transformed = points.map(group => ({
    points: group.points.map(p => applyTransform(p, obj.transform)),
    closed: group.closed,
  }));

  return transformed.map(group =>
    flatPathFromPoints(group.points, group.closed, obj.id)
  );
}

// ─── GEOMETRY TO POINTS ──────────────────────────────────────────

interface PointGroup {
  points: Point[];
  closed: boolean;
}

function geometryToPoints(geom: Geometry): PointGroup[] {
  switch (geom.type) {
    case 'rect': {
      const { x, y, width, height } = geom;
      return [{
        points: [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
        closed: true,
      }];
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = geom;
      const segments = Math.max(32, Math.ceil(Math.max(rx, ry) * 4));
      const points: Point[] = [];
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push({
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
        });
      }
      return [{ points, closed: true }];
    }
    case 'line': {
      return [{
        points: [
          { x: geom.x1, y: geom.y1 },
          { x: geom.x2, y: geom.y2 },
        ],
        closed: false,
      }];
    }
    case 'polygon': {
      return [{
        points: [...geom.points],
        closed: geom.closed,
      }];
    }
    case 'path': {
      // Convert path segments to polylines
      // Bezier curves are subdivided into line segments
      return geom.subPaths.map(sub => ({
        points: subPathToPoints(sub.segments),
        closed: sub.closed,
      }));
    }
    case 'text':
      // Text must be converted to paths before reaching here
      // (handled in a future text-to-path module)
      return [];
    case 'image':
      // Images are handled by the raster pipeline, not here
      return [];
  }
}

function subPathToPoints(segments: import('../scene/SceneObject').PathSegment[]): Point[] {
  const points: Point[] = [];

  for (const seg of segments) {
    switch (seg.type) {
      case 'move':
      case 'line':
        points.push({ ...seg.to });
        break;
      case 'cubic':
        // Subdivide cubic bezier into line segments
        subdivideCubic(
          points[points.length - 1] || { x: 0, y: 0 },
          seg.cp1, seg.cp2, seg.to,
          points, 0.5 // tolerance in mm
        );
        break;
      case 'quadratic':
        subdivideQuadratic(
          points[points.length - 1] || { x: 0, y: 0 },
          seg.cp, seg.to,
          points, 0.5
        );
        break;
      case 'close':
        // Closing is handled by the FlatPath.closed flag
        break;
    }
  }

  return points;
}

// ─── BEZIER SUBDIVISION ──────────────────────────────────────────

function subdivideCubic(
  p0: Point, p1: Point, p2: Point, p3: Point,
  output: Point[], tolerance: number, depth: number = 0
): void {
  if (depth > 10) {
    output.push({ ...p3 });
    return;
  }

  // Flatness test: are control points close to the line p0→p3?
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  const len = Math.sqrt(dx * dx + dy * dy);

  if ((d1 + d2) / (len || 1) < tolerance) {
    output.push({ ...p3 });
    return;
  }

  // De Casteljau subdivision at t=0.5
  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const m23 = midpoint(p2, p3);
  const m012 = midpoint(m01, m12);
  const m123 = midpoint(m12, m23);
  const mid = midpoint(m012, m123);

  subdivideCubic(p0, m01, m012, mid, output, tolerance, depth + 1);
  subdivideCubic(mid, m123, m23, p3, output, tolerance, depth + 1);
}

function subdivideQuadratic(
  p0: Point, p1: Point, p2: Point,
  output: Point[], tolerance: number, depth: number = 0
): void {
  if (depth > 10) {
    output.push({ ...p2 });
    return;
  }

  const dx = p2.x - p0.x, dy = p2.y - p0.y;
  const d = Math.abs((p1.x - p2.x) * dy - (p1.y - p2.y) * dx);
  const len = Math.sqrt(dx * dx + dy * dy);

  if (d / (len || 1) < tolerance) {
    output.push({ ...p2 });
    return;
  }

  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const mid = midpoint(m01, m12);

  subdivideQuadratic(p0, m01, mid, output, tolerance, depth + 1);
  subdivideQuadratic(mid, m12, p2, output, tolerance, depth + 1);
}

// ─── TRANSFORM HELPERS ───────────────────────────────────────────

function applyTransform(p: Point, m: import('../types').Matrix3x2): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
