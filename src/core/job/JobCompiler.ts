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
 * Canvas → machine Y mapping for G-code is **not** done here; see
 * `applyMachineTransform` in `/src/core/plan/MachineTransform.ts` (uses device
 * `originCorner` and physical bed height from profile or GRBL $$).
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/Layer.ts
 *   - /src/core/job/Job.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { type Point, type AABB, emptyAABB, mergeAABB, generateId, MAX_LASER_SPEED, MIN_LASER_SPEED } from '../types';
import { type Scene, getOutputLayers, getObjectsByLayer } from '../scene/Scene';
import { type SceneObject, type Geometry, type ImageGeometry } from '../scene/SceneObject';
import { type ImageRasterMode, type Layer, sortLayersByProcessingOrder } from '../scene/Layer';
import { ditherImage, type DitherMode } from '../../import/Dithering';
import {
  adjustBrightness,
  adjustContrast,
  adjustGamma,
  invertImage,
  thresholdToOneBit,
} from '../image/ImageProcessing';
import {
  type Job, type Operation, type OperationType, type OperationGeometry,
  type ResolvedLaserSettings, type FlatPath, type ProcessedBitmap,
  createEmptyJob, flatPathFromPoints,
} from './Job';
import { orderOperationsWithMetrics, type OrderableShape } from '../plan/OperationOrderer';

export interface CompileJobOptions {
  optimizeOrder?: boolean;
}

function vectorOpToOrderableShape(
  op: Operation,
  layerPhase: number,
  sceneIndex: number,
): OrderableShape | null {
  if (op.geometry.type !== 'vector' && op.geometry.type !== 'fill') return null;
  const paths = op.geometry.paths;
  if (paths.length === 0) return null;
  const c = paths[0].coords;
  if (c.length < 2) return null;
  const mode: OrderableShape['mode'] =
    op.type === 'engrave' ? 'engrave' : op.type === 'score' ? 'score' : 'cut';
  return {
    id: op.id,
    mode,
    boundingBox: { ...op.bounds },
    startPoint: { x: c[0], y: c[1] },
    endPoint: { x: c[0], y: c[1] },
    layerIndex: layerPhase,
    sceneIndex,
    settingsKey: JSON.stringify(op.settings),
    operation: op,
  };
}

function objectsOnLayerInSceneOrder(scene: Scene, layerId: string): SceneObject[] {
  return scene.objects.filter(o => o.layerId === layerId && o.visible);
}

// ─── MAIN COMPILER ───────────────────────────────────────────────

export function compileJob(scene: Scene, options?: CompileJobOptions): Job {
  const job = createEmptyJob(scene.metadata.name, scene.id);
  const outputLayers = sortLayersByProcessingOrder(getOutputLayers(scene));
  const optimizeOrder = options?.optimizeOrder ?? scene.compileOptions?.optimizeOrder !== false;

  let totalObjects = 0;

  if (!optimizeOrder) {
    for (const layer of outputLayers) {
      const objects = getObjectsByLayer(scene, layer.id);
      if (objects.length === 0) continue;

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
  } else {
    const firstImageLayerPhase = outputLayers.findIndex(l => l.settings.mode === 'image');
    const splitPhase = firstImageLayerPhase < 0 ? outputLayers.length : firstImageLayerPhase;

    const rasterOps: Operation[] = [];
    const preVectorShapes: OrderableShape[] = [];
    const postVectorShapes: OrderableShape[] = [];

    for (let phase = 0; phase < outputLayers.length; phase++) {
      const layer = outputLayers[phase];
      const orderedObjs = objectsOnLayerInSceneOrder(scene, layer.id);
      if (orderedObjs.length === 0) continue;

      if (layer.settings.mode === 'image') {
        for (const obj of orderedObjs) {
          if (obj.geometry.type !== 'image') continue;
          const imgOp = compileOperation(layer, [obj]);
          if (imgOp) {
            rasterOps.push(imgOp);
            job.bounds = mergeAABB(job.bounds, imgOp.bounds);
            totalObjects++;
          }
        }
        continue;
      }

      const targetPool = phase < splitPhase ? preVectorShapes : postVectorShapes;
      const sceneIndexById = new Map(scene.objects.map((o, i) => [o.id, i]));

      for (const obj of orderedObjs) {
        const op = compileOperation(layer, [obj]);
        if (!op) continue;
        if (op.geometry.type !== 'vector' && op.geometry.type !== 'fill') continue;
        const shape = vectorOpToOrderableShape(op, phase, sceneIndexById.get(obj.id) ?? 0);
        if (!shape) continue;
        targetPool.push(shape);
        totalObjects++;
      }
    }

    const pushOrdered = (pool: OrderableShape[], label: string) => {
      if (pool.length === 0) return;
      const distinctKeys = new Set(pool.map(s => s.settingsKey));
      if (distinctKeys.size > 6) {
        console.warn(
          `[Optimize] Many distinct laser setting groups (${distinctKeys.size}) in ${label} — order stays within settings groups (no cross-settings NN).`,
        );
      }
      const { ordered } = orderOperationsWithMetrics(pool, '[Optimize]');
      for (const s of ordered) {
        const op = s.operation;
        if (!op) continue;
        job.operations.push(op);
        job.bounds = mergeAABB(job.bounds, op.bounds);
      }
    };

    pushOrdered(preVectorShapes, 'pre-raster');
    for (const ro of rasterOps) {
      job.operations.push(ro);
    }
    pushOrdered(postVectorShapes, 'post-raster');
  }

  job.metadata.objectCount = totalObjects;
  job.metadata.layerCount = job.operations.length;

  const spX = scene.startPosition?.x ?? 0;
  const spY = scene.startPosition?.y ?? 0;
  job.metadata.startPositionX = spX;
  job.metadata.startPositionY = spY;

  return job;
}

// ─── COMPILE SINGLE OPERATION ────────────────────────────────────

function compileOperation(layer: Layer, objects: SceneObject[]): Operation | null {
  const type = mapModeToType(layer.settings.mode);
  const settings = resolveSettings(layer);
  const geometry = compileGeometry(type, layer, objects);

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
  /** Engrave always needs scanline spacing; do not rely only on fill.enabled. */
  const fillActiveForEngrave = s.fill.enabled || s.mode === 'engrave';
  const rawIv = Number(s.fill.interval);
  const engraveFillInterval =
    s.mode === 'engrave' && fillActiveForEngrave
      ? Math.max(0.01, Number.isFinite(rawIv) && rawIv > 0 ? rawIv : 0.1)
      : 0;
  return {
    powerMin: Math.max(0, Math.min(100, s.power.min)),
    powerMax: Math.max(0, Math.min(100, s.power.max)),
    speed: Math.max(MIN_LASER_SPEED, Math.min(MAX_LASER_SPEED, s.speed)),
    passes: Math.max(1, Math.min(99, s.passes)),
    zStepPerPass: s.zStepPerPass,

    fillInterval: engraveFillInterval,
    fillAngle: s.fill.angle % 360,
    fillMode: s.fill.mode === 'offset' || s.fill.mode === 'cross-hatch' ? s.fill.mode : 'line',
    fillBiDirectional: s.fill.biDirectional !== false,
    overscanning: Math.max(0, s.fill.overscanning),

    overcut: Math.max(0, s.cut.overcut),
    leadIn: Math.max(0, s.cut.leadIn),
    tabCount: s.tabs?.enabled === true
      ? Math.max(0, Math.floor(Number(s.tabs?.count) || 0))
      : Math.max(0, Math.floor(s.cut.tabCount)),
    tabWidth: s.tabs?.enabled === true
      ? Math.max(0, Number(s.tabs?.width) || 0)
      : Math.max(0, s.cut.tabWidth),
    insideFirst: s.cut.insideFirst,

    airAssist: s.airAssist,
  };
}

// ─── COMPILE GEOMETRY ────────────────────────────────────────────

/** Reverse raster rows and/or columns so negative scale (mirror) matches canvas preview. */
function mirrorRasterData(
  data: Uint8Array,
  width: number,
  height: number,
  flipX: boolean,
  flipY: boolean,
): Uint8Array {
  let buf = data;
  if (flipY) {
    const next = new Uint8Array(width * height);
    for (let r = 0; r < height; r++) {
      next.set(buf.subarray(r * width, (r + 1) * width), (height - 1 - r) * width);
    }
    buf = next;
  }
  if (flipX) {
    const next = new Uint8Array(buf.length);
    for (let r = 0; r < height; r++) {
      const row = r * width;
      for (let c = 0; c < width; c++) {
        next[row + c] = buf[row + (width - 1 - c)];
      }
    }
    buf = next;
  }
  return buf;
}

function compileGeometry(
  type: OperationType,
  layer: Layer,
  objects: SceneObject[]
): OperationGeometry | null {
  if (type === 'raster') {
    const img = layer.settings.image;
    const dpiRaw = img.resolution;
    const dpi =
      typeof dpiRaw === 'number' && Number.isFinite(dpiRaw) && dpiRaw > 0 ? dpiRaw : 254;

    const brightness = typeof img.brightness === 'number' && Number.isFinite(img.brightness)
      ? Math.max(-100, Math.min(100, img.brightness))
      : 0;
    const contrast = typeof img.contrast === 'number' && Number.isFinite(img.contrast)
      ? Math.max(-100, Math.min(100, img.contrast))
      : 0;
    const gamma = typeof img.gamma === 'number' && Number.isFinite(img.gamma) ? img.gamma : 1;
    const inverted = img.invert === true;
    const ditherMode: DitherMode = img.dithering ?? 'floyd-steinberg';
    const imageThreshold =
      typeof img.imageThreshold === 'number' && Number.isFinite(img.imageThreshold)
        ? Math.max(0, Math.min(255, img.imageThreshold))
        : 128;
    const imageMode: ImageRasterMode = img.imageMode ?? (img.passThrough ? 'grayscale' : 'dither');

    for (const obj of objects) {
      if (!obj.visible) continue;
      if (obj.geometry.type !== 'image') continue;

      const geom = obj.geometry;
      const sx = obj.transform.a;
      const sy = obj.transform.d;
      const scaleAbsX = Math.abs(sx) || 1;
      const scaleAbsY = Math.abs(sy) || 1;
      const wMm = ((geom.cropWidth || geom.originalWidth) / 96) * 25.4;
      const hMm = ((geom.cropHeight || geom.originalHeight) / 96) * 25.4;
      const physicalWidth = wMm * scaleAbsX;
      const physicalHeight = hMm * scaleAbsY;
      const flipRasterX = sx < 0;
      const flipRasterY = sy < 0;
      const rasterPosX = Math.min(obj.transform.tx, obj.transform.tx + sx * wMm);
      const rasterPosY = Math.min(obj.transform.ty, obj.transform.ty + sy * hMm);

      let bitmapWidth: number;
      let bitmapHeight: number;
      let data: Uint8Array;
      let mode: '1bit' | 'grayscale';

      const pixelData = geom.grayscaleData;
      if (pixelData && geom.grayscaleWidth && geom.grayscaleHeight) {
        bitmapWidth = geom.grayscaleWidth;
        bitmapHeight = geom.grayscaleHeight;
        let gray = new Uint8Array(pixelData);
        if (brightness !== 0) gray = adjustBrightness(gray, brightness);
        if (contrast !== 0) gray = adjustContrast(gray, contrast);
        if (gamma !== 1) gray = adjustGamma(gray, gamma);
        if (inverted) gray = invertImage(gray);

        if (imageMode === 'grayscale') {
          data = gray;
          mode = 'grayscale';
        } else if (imageMode === 'threshold') {
          data = thresholdToOneBit(gray, bitmapWidth, bitmapHeight, imageThreshold);
          mode = '1bit';
        } else {
          if (ditherMode === 'none') {
            data = gray;
            mode = 'grayscale';
          } else {
            data = ditherImage(gray, bitmapWidth, bitmapHeight, ditherMode, imageThreshold);
            mode = '1bit';
          }
        }
        if (flipRasterX || flipRasterY) {
          data = mirrorRasterData(data, bitmapWidth, bitmapHeight, flipRasterX, flipRasterY);
        }
      } else {
        console.warn(
          `[LaserForge] Skipping image "${obj.name || obj.id}": no raster bitmap data (import or adjust image to produce grayscale pixels).`,
        );
        return null;
      }

      const bitmap: ProcessedBitmap = {
        width: bitmapWidth,
        height: bitmapHeight,
        dpi,
        mode,
        data,
        physicalWidth,
        physicalHeight,
        position: {
          x: rasterPosX,
          y: rasterPosY,
        },
        pipeline: {
          brightness,
          contrast,
          gamma,
          ditheringMode: ditherMode,
          inverted,
          imageMode,
          imageThreshold,
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

  return transformed.map(group => {
    let pts = group.points;
    if (group.closed && pts.length > 1) {
      const idx = (obj.cutStartIndex ?? 0) % pts.length;
      if (idx !== 0) {
        pts = [...pts.slice(idx), ...pts.slice(0, idx)];
      }
    }
    return flatPathFromPoints(pts, group.closed, obj.id, obj.powerScale ?? 1.0);
  });
}

// ─── GEOMETRY TO POINTS ──────────────────────────────────────────

export interface PointGroup {
  points: Point[];
  closed: boolean;
}

export function geometryToPoints(geom: Geometry): PointGroup[] {
  switch (geom.type) {
    case 'rect': {
      const { x, y, width, height, cornerRadius } = geom;
      const r = Math.min(cornerRadius || 0, width / 2, height / 2);

      if (r <= 0.01) {
        // Sharp corners
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

      // Rounded corners — generate arc segments
      const pts: Point[] = [];
      const arcSegments = Math.max(4, Math.ceil(r * 2)); // More segments for larger radii

      // Helper: generate quarter arc points
      const quarterArc = (cx: number, cy: number, startAngle: number) => {
        for (let i = 0; i <= arcSegments; i++) {
          const angle = startAngle + (Math.PI / 2) * (i / arcSegments);
          pts.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
          });
        }
      };

      // Top edge: left to right, then top-right arc
      pts.push({ x: x + r, y });
      pts.push({ x: x + width - r, y });
      quarterArc(x + width - r, y + r, -Math.PI / 2); // Top-right corner

      // Right edge: top to bottom, then bottom-right arc
      pts.push({ x: x + width, y: y + r });
      pts.push({ x: x + width, y: y + height - r });
      quarterArc(x + width - r, y + height - r, 0); // Bottom-right corner

      // Bottom edge: right to left, then bottom-left arc
      pts.push({ x: x + width - r, y: y + height });
      pts.push({ x: x + r, y: y + height });
      quarterArc(x + r, y + height - r, Math.PI / 2); // Bottom-left corner

      // Left edge: bottom to top, then top-left arc
      pts.push({ x, y: y + height - r });
      pts.push({ x, y: y + r });
      quarterArc(x + r, y + r, Math.PI); // Top-left corner

      // Remove duplicate consecutive points
      const cleaned: Point[] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const prev = cleaned[cleaned.length - 1];
        if (Math.abs(pts[i].x - prev.x) > 0.001 || Math.abs(pts[i].y - prev.y) > 0.001) {
          cleaned.push(pts[i]);
        }
      }

      return [{ points: cleaned, closed: true }];
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
    case 'text': {
      const subPaths = geom.outlineSubPaths;
      if (!subPaths?.length) return [];
      return subPaths.map(sub => ({
        points: subPathToPoints(sub.segments),
        closed: sub.closed,
      }));
    }
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
