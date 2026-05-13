/**
 * === FILE: /src/ui/renderers/SceneRenderer.ts ===
 *
 * Purpose:    Pure rendering functions for Scene content. Takes a
 *             CanvasRenderingContext2D, Scene data, and a Transform.
 *             No React, no state — just draw calls.
 *
 *             Rendering order:
 *             1. Bed boundary
 *             2. Grid
 *             3. Origin marker
 *             4. Scene objects (per layer, in layer color)
 *
 * Dependencies:
 *   - /src/core/scene/* (Scene, SceneObject, Layer)
 *   - /src/ui/viewport.ts (Transform)
 * Last updated: Object selection — added selection highlight rendering
 */

import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type Geometry, type ImageGeometry, type TextGeometry } from '../../core/scene/SceneObject';
import { type Layer, type LayerMode } from '../../core/scene/Layer';
import { type Transform } from '../viewport';
import { type AABB, type Matrix3x2, aabbIntersects } from '../../core/types';
import { computeObjectBounds } from '../../geometry/bounds';
import { fillTextGeometry } from '../../geometry/textCanvasDraw';
import { getImageRenderSrc } from '../../io/ImageStore';
import { type BurnState } from '../../app/MachineService';
// T1-132: overlay-bounds helpers + types extracted to sibling module so
// they can be unit-tested without loading the renderer surface.
import {
  computeSceneBounds,
  resolveMachineOriginMarker,
  type MachineOriginMarker,
  type SceneBounds,
  type SceneMachineOverlayOptions,
} from './sceneOverlayHelpers';
// T1-138: local-space corner helper for fill-preview AABB extracted
// so the geometry-type switch can be tested without canvas dependencies.
import { getSceneObjectLocalCorners } from './sceneCornerHelpers';
// T1-146: pure predicates + the preview-stroke color mapping extracted
// so the predicates / colors can be tested without canvas mocks.
import {
  isCurrentTransformFinite,
  isRenderableAabb,
  isSafeObjectMatrix,
  previewStrokeForMode,
} from './sceneRendererPredicates';

/** CanvasRenderer listens for this so async image decode triggers a repaint (resize alone does not). */
const CANVAS_REPAINT_EVENT = 'laserforge-canvas-repaint';

function dispatchCanvasRepaint(): void {
  window.dispatchEvent(new Event(CANVAS_REPAINT_EVENT));
}

// T1-146: isCurrentTransformFinite / isRenderableAabb / isSafeObjectMatrix
// moved to ./sceneRendererPredicates.

// Global content-keyed caches (LRU) — moving/transforming an object does not evict entries.
const RENDER_CACHE_CAP = 100;

const imageElementBySrc = new Map<string, HTMLImageElement>();
const idbResolvedUriBySrc = new Map<string, string>();
const idbPendingSrc = new Set<string>();
const ditherCanvasByKey = new Map<string, HTMLCanvasElement>();

function shrinkMap<K, V>(m: Map<K, V>): void {
  while (m.size > RENDER_CACHE_CAP) {
    const oldestKey = m.keys().next().value;
    if (oldestKey === undefined) break;
    m.delete(oldestKey);
  }
}

function touchMap<K, V>(m: Map<K, V>, key: K): void {
  const v = m.get(key);
  if (v === undefined) return;
  m.delete(key);
  m.set(key, v);
}

/**
 * FNV-1a 32-bit hash for cache key discrimination.
 *
 * Not cryptographic -- used only to fingerprint pixel buffers so the
 * dither preview cache can tell two adjustedData arrays apart even when
 * they have the same length (T1-17 Pass 2). Math.imul forces 32-bit
 * signed-int multiplication; `>>> 0` coerces to unsigned. Both
 * Uint8Array and Uint8ClampedArray are accepted because canvas
 * ImageData uses Uint8ClampedArray.
 */
export function fnv1a32(data: Uint8Array | Uint8ClampedArray): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Build the dither preview cache key.
 *
 * Includes a content hash of `adjustedData` so brightness/contrast/gamma
 * changes that produce buffers of the same length still get distinct
 * keys. Before T1-17 Pass 2 the key embedded `adjustedData.length`,
 * which only depends on image dimensions, so any two settings produced
 * the same key and the cache returned the stale dither buffer.
 */
export function buildDitherCacheKey(
  loadSrc: string,
  grayscaleWidth: number,
  grayscaleHeight: number,
  ditherMode: string,
  adjustedData: Uint8Array,
): string {
  const contentHash = fnv1a32(adjustedData).toString(36);
  return `${loadSrc}\x1e${grayscaleWidth}\x1e${grayscaleHeight}\x1e${ditherMode}\x1e${contentHash}`;
}

function getOrCreateImage(loadSrc: string): HTMLImageElement {
  let img = imageElementBySrc.get(loadSrc);
  if (img) {
    touchMap(imageElementBySrc, loadSrc);
    return img;
  }
  img = new Image();
  img.src = loadSrc;
  imageElementBySrc.set(loadSrc, img);
  img.onload = () => {
    dispatchCanvasRepaint();
  };
  shrinkMap(imageElementBySrc);
  return img;
}

function setIdbResolved(srcKey: string, uri: string): void {
  idbResolvedUriBySrc.delete(srcKey);
  idbResolvedUriBySrc.set(srcKey, uri);
  shrinkMap(idbResolvedUriBySrc);
}

function getIdbResolved(srcKey: string): string | undefined {
  const u = idbResolvedUriBySrc.get(srcKey);
  if (u !== undefined) touchMap(idbResolvedUriBySrc, srcKey);
  return u;
}

function ditherCacheGet(key: string): HTMLCanvasElement | undefined {
  const c = ditherCanvasByKey.get(key);
  if (!c) return undefined;
  touchMap(ditherCanvasByKey, key);
  return c;
}

function ditherCacheSet(key: string, canvas: HTMLCanvasElement): void {
  ditherCanvasByKey.delete(key);
  ditherCanvasByKey.set(key, canvas);
  shrinkMap(ditherCanvasByKey);
}

// T1-132: SceneMachineOverlayOptions, MachineOriginMarker,
// computeSceneBounds, hasSceneBounds, positiveFinite,
// resolveBedOriginMarker, and resolveMachineOriginMarker have moved to
// ./sceneOverlayHelpers (re-imported above). The types are re-exported
// here to preserve the public surface.
export type { SceneMachineOverlayOptions, MachineOriginMarker } from './sceneOverlayHelpers';
export { resolveMachineOriginMarker } from './sceneOverlayHelpers';

// ─── MAIN RENDER ─────────────────────────────────────────────────

function renderMachineWorkAreaOverlay(
  ctx: CanvasRenderingContext2D,
  machine: { width: number; height: number },
  transform: Transform,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 196, 72, 0.75)';
  ctx.setLineDash([transform.screenPx(5), transform.screenPx(4)]);
  ctx.lineWidth = transform.screenPx(1.2);
  ctx.strokeRect(0, 0, machine.width, machine.height);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 196, 72, 0.92)';
  ctx.font = `${Math.max(9, transform.screenPx(10))}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${machine.width}×${machine.height} mm (machine)`, 3, 3);
  ctx.restore();
}

function renderMachineOriginOverlay(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  sceneBounds: SceneBounds,
  options: SceneMachineOverlayOptions,
): void {
  const marker = resolveMachineOriginMarker(sceneBounds, options);
  if (!marker) return;

  const origin = transform.worldToScreen(marker);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const size = 9;
  ctx.strokeStyle = 'rgba(45, 212, 160, 0.58)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.x - size, origin.y);
  ctx.lineTo(origin.x + size, origin.y);
  ctx.moveTo(origin.x, origin.y - size);
  ctx.lineTo(origin.x, origin.y + size);
  ctx.stroke();

  ctx.fillStyle = 'rgba(45, 212, 160, 0.22)';
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(190, 255, 235, 0.68)';
  ctx.font = '10px monospace';
  ctx.fillText(marker.label, origin.x + size + 4, origin.y + 4);
  ctx.restore();
}

/** Bed, grid, origin, crosshair — leaves ctx with transform applied (outer save still active). */
export function renderSceneBackground(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  machineWorkAreaMm: { width: number; height: number } | null = null,
  machineOverlay: SceneMachineOverlayOptions = {},
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  transform.applyToContext(ctx);
  if (!isCurrentTransformFinite(ctx)) {
    console.error('[Canvas] World transform contains NaN/Infinity after applyToContext (background)');
    ctx.restore();
    return;
  }

  renderBed(ctx, scene.canvas.width, scene.canvas.height, transform);
  renderGrid(ctx, scene.canvas.width, scene.canvas.height, transform);

  if (
    machineWorkAreaMm &&
    machineWorkAreaMm.width > 0 &&
    machineWorkAreaMm.height > 0
  ) {
    renderMachineWorkAreaOverlay(ctx, machineWorkAreaMm, transform);
  }

  const sceneBounds = computeSceneBounds(scene);
  renderMachineOriginOverlay(ctx, transform, sceneBounds, machineOverlay);

  // ─── MATERIAL RECTANGLE ─────────────────────────────────────────
  if (scene.material) {
    const mat = scene.material;
    ctx.save();

    // Material fill — warm color based on type
    const materialColors: Record<string, { fill: string; stroke: string; grain: boolean }> = {
      wood:      { fill: 'rgba(139, 90, 43, 0.18)', stroke: 'rgba(139, 90, 43, 0.5)', grain: true },
      acrylic:   { fill: 'rgba(100, 180, 255, 0.12)', stroke: 'rgba(100, 180, 255, 0.4)', grain: false },
      leather:   { fill: 'rgba(160, 82, 45, 0.18)', stroke: 'rgba(160, 82, 45, 0.5)', grain: false },
      paper:     { fill: 'rgba(240, 230, 210, 0.15)', stroke: 'rgba(200, 190, 170, 0.4)', grain: false },
      fabric:    { fill: 'rgba(180, 130, 180, 0.12)', stroke: 'rgba(180, 130, 180, 0.4)', grain: false },
      cardboard: { fill: 'rgba(170, 130, 80, 0.15)', stroke: 'rgba(170, 130, 80, 0.4)', grain: false },
      metal:     { fill: 'rgba(180, 190, 200, 0.12)', stroke: 'rgba(180, 190, 200, 0.4)', grain: false },
      custom:    { fill: 'rgba(150, 150, 150, 0.12)', stroke: 'rgba(150, 150, 150, 0.4)', grain: false },
    };

    const mc = materialColors[mat.type] || materialColors.custom;

    // Fill
    ctx.fillStyle = mc.fill;
    ctx.fillRect(mat.x, mat.y, mat.width, mat.height);

    // Simulated wood grain lines (subtle horizontal lines)
    if (mc.grain) {
      ctx.strokeStyle = 'rgba(100, 60, 20, 0.06)';
      ctx.lineWidth = transform.screenPx(1);
      const grainSpacing = 3; // mm between grain lines
      for (let gy = mat.y + grainSpacing; gy < mat.y + mat.height; gy += grainSpacing) {
        ctx.beginPath();
        // Slightly wavy grain
        ctx.moveTo(mat.x, gy);
        const steps = Math.ceil(mat.width / 10);
        for (let i = 1; i <= steps; i++) {
          const gx = mat.x + (i / steps) * mat.width;
          const wave = Math.sin(i * 0.7 + gy * 0.3) * 0.5;
          ctx.lineTo(gx, gy + wave);
        }
        ctx.stroke();
      }
    }

    // Border
    ctx.strokeStyle = mc.stroke;
    ctx.lineWidth = transform.screenPx(1.5);
    ctx.setLineDash([]);
    ctx.strokeRect(mat.x, mat.y, mat.width, mat.height);

    // Dimension labels
    ctx.fillStyle = mc.stroke;
    ctx.font = `${transform.screenPx(10)}px "DM Sans", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Width label (bottom)
    ctx.fillText(
      `${mat.width}mm`,
      mat.x + mat.width / 2,
      mat.y + mat.height + transform.screenPx(4)
    );
    // Height label (right)
    ctx.save();
    ctx.translate(mat.x + mat.width + transform.screenPx(4), mat.y + mat.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${mat.height}mm`, 0, 0);
    ctx.restore();

    // Material name label (top-left inside)
    ctx.font = `${transform.screenPx(9)}px "DM Sans", system-ui, sans-serif`;
    ctx.fillStyle = mc.stroke;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(mat.name, mat.x + transform.screenPx(4), mat.y + transform.screenPx(4));

    ctx.restore();
  }

  renderOrigin(ctx, transform);

  const bedW = scene.canvas.width;
  const bedH = scene.canvas.height;
  const cxBed = bedW / 2;
  const cyBed = bedH / 2;
  const crossSize = 10;
  ctx.save();
  ctx.strokeStyle = 'rgba(59, 139, 235, 0.4)';
  ctx.lineWidth = transform.screenPx(1);
  ctx.setLineDash([transform.screenPx(4), transform.screenPx(3)]);
  ctx.beginPath();
  ctx.moveTo(cxBed - crossSize, cyBed);
  ctx.lineTo(cxBed + crossSize, cyBed);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cxBed, cyBed - crossSize);
  ctx.lineTo(cxBed, cyBed + crossSize);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export type RenderSceneObjectsOptions = {
  /**
   * When true, skip the final `ctx.restore()` so the caller can pop a nested save
   * (e.g. globalAlpha) between two `renderSceneObjects` passes without the trailing
   * restore consuming the viewport world save.
   */
  skipTrailingContextRestore?: boolean;
};

/** Objects + selection highlights + restores one pushed graphics state (caller save). */
export function renderSceneObjects(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  selectedIds?: ReadonlySet<string>,
  previewMode: boolean = false,
  options?: RenderSceneObjectsOptions,
  burnState?: BurnState | null,
): void {
  const visibleBounds = transform.getVisibleWorldBounds(canvasWidth, canvasHeight);

  // Fresh each frame — object colors follow the layer's current `settings.mode` (no stale cache).
  const layerMap = new Map<string, Layer>();
  for (const layer of scene.layers) {
    layerMap.set(layer.id, layer);
  }

  const boundsCache = selectedIds && selectedIds.size > 0
    ? new Map<string, AABB>()
    : null;

  // Preview mode: simulated burn marks on material (replaces normal object pass).
  if (previewMode && scene.material && scene.material.enabled !== false) {
    const mat = scene.material;

    ctx.save();
    // Transform is already applied by CanvasViewport / renderScene.

    // 1. Draw solid material background
    ctx.fillStyle = mat.color || '#c4a882';
    ctx.fillRect(mat.x, mat.y, mat.width, mat.height);

    // 2. Subtle wood grain
    if (mat.type === 'wood') {
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = '#6B5335';
      ctx.lineWidth = transform.screenPx(0.6);
      for (let gy = mat.y; gy < mat.y + mat.height; gy += 2.5) {
        const w1 = Math.sin(gy * 0.3) * 2;
        const w2 = Math.sin(gy * 0.7) * 0.8;
        ctx.beginPath();
        ctx.moveTo(mat.x, gy + w1);
        ctx.bezierCurveTo(
          mat.x + mat.width * 0.3, gy + w1 + w2,
          mat.x + mat.width * 0.7, gy + w1 - w2,
          mat.x + mat.width, gy + w1 * 0.6
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 3. Acrylic sheen
    if (mat.type === 'acrylic') {
      const grad = ctx.createLinearGradient(mat.x, mat.y, mat.x + mat.width, mat.y + mat.height);
      grad.addColorStop(0, 'rgba(255,255,255,0.05)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      grad.addColorStop(1, 'rgba(255,255,255,0.03)');
      ctx.fillStyle = grad;
      ctx.fillRect(mat.x, mat.y, mat.width, mat.height);
    }

    // 4. Draw each object as a burn mark
    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      const layer = scene.layers.find(l => l.id === obj.layerId);
      if (!layer || !layer.visible) continue;

      const mode = layer.settings.mode;
      const power = layer.settings.power.max / 100;

      const t = obj.transform;
      if (!isSafeObjectMatrix(t)) continue;

      ctx.save();
      ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
      if (!isCurrentTransformFinite(ctx)) {
        console.error('[Canvas] Preview: bad object transform', obj.id);
        ctx.restore();
        continue;
      }

      const geom = obj.geometry as any;

      // Build path
      ctx.beginPath();
      if (geom.type === 'rect') {
        ctx.rect(geom.x || 0, geom.y || 0, geom.width, geom.height);
      } else if (geom.type === 'ellipse') {
        ctx.ellipse(geom.cx, geom.cy, geom.rx, geom.ry, 0, 0, Math.PI * 2);
      } else if (geom.type === 'line') {
        ctx.moveTo(geom.x1, geom.y1);
        ctx.lineTo(geom.x2, geom.y2);
      } else if (geom.type === 'path') {
        for (const sp of (geom.subPaths || [])) {
          for (const seg of sp.segments) {
            if (seg.type === 'move') ctx.moveTo(seg.to.x, seg.to.y);
            else if (seg.type === 'line') ctx.lineTo(seg.to.x, seg.to.y);
            else if (seg.type === 'cubic') ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y);
            else if (seg.type === 'quadratic') ctx.quadraticCurveTo(seg.cp.x, seg.cp.y, seg.to.x, seg.to.y);
            else if (seg.type === 'close') ctx.closePath();
          }
        }
      } else if (geom.type === 'polygon') {
        const pts = geom.points || [];
        if (pts.length > 0) {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          if (geom.closed) ctx.closePath();
        }
      } else if (geom.type === 'text') {
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(30, 15, 0, ${0.5 + power * 0.5})`;
        fillTextGeometry(ctx, geom as TextGeometry, 0, 0);
        ctx.restore();
        continue;
      } else if (geom.type === 'image') {
        ctx.restore();
        continue;
      } else {
        ctx.restore();
        continue;
      }

      // Render based on mode
      if (mode === 'cut') {
        // Cut: thin dark burn line with glow
        ctx.strokeStyle = `rgba(25, 10, 0, ${0.6 + power * 0.4})`;
        ctx.lineWidth = transform.screenPx(1.2);
        ctx.shadowColor = `rgba(40, 15, 0, ${power * 0.4})`;
        ctx.shadowBlur = transform.screenPx(3);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Slight inner edge (kerf simulation)
        ctx.strokeStyle = `rgba(60, 30, 0, ${power * 0.2})`;
        ctx.lineWidth = transform.screenPx(2.5);
        ctx.stroke();
      } else if (mode === 'engrave') {
        // Engrave: filled dark area
        ctx.fillStyle = `rgba(35, 18, 0, ${power * 0.55})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(25, 10, 0, ${power * 0.3})`;
        ctx.lineWidth = transform.screenPx(0.5);
        ctx.stroke();
      } else if (mode === 'score') {
        // Score: light surface mark
        ctx.strokeStyle = `rgba(50, 25, 5, ${power * 0.35})`;
        ctx.lineWidth = transform.screenPx(0.8);
        ctx.stroke();
      } else {
        ctx.restore();
        continue;
      }

      ctx.restore();
    }

    // 5. Material border
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = transform.screenPx(1);
    ctx.strokeRect(mat.x, mat.y, mat.width, mat.height);

    // 6. Subtle shadow under material
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = transform.screenPx(8);
    ctx.shadowOffsetX = transform.screenPx(2);
    ctx.shadowOffsetY = transform.screenPx(2);
    ctx.strokeStyle = 'transparent';
    ctx.lineWidth = 0;
    ctx.strokeRect(mat.x, mat.y, mat.width, mat.height);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.restore();
    return;
  }

  for (const obj of scene.objects) {
    const layer = layerMap.get(obj.layerId);
    if (!layer || !layer.visible) continue;

    const objBounds = computeObjectBounds(obj);
    if (!isRenderableAabb(objBounds)) continue;
    if (!aabbIntersects(objBounds, visibleBounds)) continue;

    if (boundsCache && selectedIds!.has(obj.id)) {
      boundsCache.set(obj.id, objBounds);
    }

    try {
      renderObject(ctx, obj, layer, transform, burnState);
    } catch (err) {
      console.error('[Canvas] Failed to render object:', obj.id, err);
    }
  }

  // Boundary warnings: highlight objects outside material
  if (scene.material) {
    const mat = scene.material;

    for (const obj of scene.objects) {
      if (!obj.visible) continue;
      const layer = layerMap.get(obj.layerId);
      if (!layer || !layer.visible) continue;

      const bounds = computeObjectBounds(obj);
      if (!bounds || !isRenderableAabb(bounds)) continue;
      if (!aabbIntersects(bounds, visibleBounds)) continue;

      const outsideLeft = bounds.minX < mat.x;
      const outsideTop = bounds.minY < mat.y;
      const outsideRight = bounds.maxX > mat.x + mat.width;
      const outsideBottom = bounds.maxY > mat.y + mat.height;

      if (outsideLeft || outsideTop || outsideRight || outsideBottom) {
        ctx.save();

        ctx.strokeStyle = 'rgba(255, 68, 102, 0.6)';
        ctx.lineWidth = transform.screenPx(2);
        ctx.setLineDash([transform.screenPx(4), transform.screenPx(3)]);
        ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255, 68, 102, 0.08)';

        if (outsideLeft) {
          ctx.fillRect(bounds.minX, bounds.minY, mat.x - bounds.minX, bounds.maxY - bounds.minY);
        }
        if (outsideRight) {
          ctx.fillRect(mat.x + mat.width, bounds.minY, bounds.maxX - (mat.x + mat.width), bounds.maxY - bounds.minY);
        }
        if (outsideTop) {
          ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, mat.y - bounds.minY);
        }
        if (outsideBottom) {
          ctx.fillRect(bounds.minX, mat.y + mat.height, bounds.maxX - bounds.minX, bounds.maxY - (mat.y + mat.height));
        }

        ctx.fillStyle = 'rgba(255, 68, 102, 0.7)';
        ctx.font = `${transform.screenPx(12)}px system-ui`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('⚠', bounds.minX, bounds.minY - transform.screenPx(2));

        ctx.restore();
      }
    }
  }

  if (!previewMode && boundsCache && boundsCache.size > 0) {
    for (const [id, bounds] of boundsCache) {
      renderSelectionHighlight(ctx, bounds, transform);
    }
  }

  if (!options?.skipTrailingContextRestore) {
    ctx.restore();
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  selectedIds?: ReadonlySet<string>,
  previewMode: boolean = false,
  machineWorkAreaMm: { width: number; height: number } | null = null,
  machineOverlay: SceneMachineOverlayOptions = {},
  burnState?: BurnState | null,
): void {
  renderSceneBackground(ctx, scene, transform, canvasWidth, canvasHeight, machineWorkAreaMm, machineOverlay);
  renderSceneObjects(ctx, scene, transform, canvasWidth, canvasHeight, selectedIds, previewMode, undefined, burnState);
}

// ─── BED ─────────────────────────────────────────────────────────

function renderBed(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: Transform
): void {
  ctx.fillStyle = '#06060c';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#222240';
  ctx.lineWidth = transform.screenPx(1.5);
  ctx.strokeRect(0, 0, width, height);
}

// ─── GRID ────────────────────────────────────────────────────────

function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: Transform
): void {
  if (transform.zoom < 0.2) return; // Too zoomed out for grid

  const minor = transform.zoom > 3 ? 1 : transform.zoom > 0.8 ? 5 : 10;
  const major = minor * 5;

  // Minor grid
  ctx.strokeStyle = '#0e0e1e';
  ctx.lineWidth = transform.screenPx(0.5);
  ctx.beginPath();
  for (let x = 0; x <= width; x += minor) {
    ctx.moveTo(x, 0); ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += minor) {
    ctx.moveTo(0, y); ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Major grid
  ctx.strokeStyle = '#1a1a30';
  ctx.lineWidth = transform.screenPx(0.8);
  ctx.beginPath();
  for (let x = 0; x <= width; x += major) {
    ctx.moveTo(x, 0); ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += major) {
    ctx.moveTo(0, y); ctx.lineTo(width, y);
  }
  ctx.stroke();
}

// ─── ORIGIN ──────────────────────────────────────────────────────

function renderOrigin(ctx: CanvasRenderingContext2D, transform: Transform): void {
  const s = transform.screenPx(6);
  ctx.strokeStyle = '#e63e6d';
  ctx.lineWidth = transform.screenPx(1);
  ctx.beginPath();
  ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
  ctx.moveTo(0, -s); ctx.lineTo(0, s);
  ctx.stroke();

  ctx.fillStyle = '#e63e6d';
  ctx.beginPath();
  ctx.arc(0, 0, transform.screenPx(2), 0, Math.PI * 2);
  ctx.fill();
}

// ─── SCENE OBJECT ────────────────────────────────────────────────

// T1-146: previewStrokeForMode moved to ./sceneRendererPredicates.

function renderObject(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layer: Layer,
  transform: Transform,
  burnState?: BurnState | null,
): void {
  const t = obj.transform;
  if (!isSafeObjectMatrix(t)) {
    console.error('[Canvas] Skipping object with non-finite transform matrix:', obj.id);
    return;
  }

  const isActive = burnState?.activeIds.has(obj.id) === true;
  const isBurned = burnState?.burnedIds.has(obj.id) === true;
  const worldBounds = computeObjectBounds(obj);

  ctx.save();
  try {
    ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
    if (!isCurrentTransformFinite(ctx)) {
      console.error('[Canvas] Object transform produced NaN/Infinity:', obj.id);
      return;
    }

    const modeColor = previewStrokeForMode(layer.settings.mode);
    if (isBurned) {
      ctx.strokeStyle = '#6a8a6a';
      ctx.globalAlpha = 0.35;
    } else {
      ctx.strokeStyle = modeColor;
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = transform.screenPx(1.2);

    const isFill = layer.settings.mode === 'engrave' || layer.settings.mode === 'image';
    if (isFill) {
      ctx.fillStyle = isBurned ? 'rgba(106,138,106,0.12)' : `${modeColor}22`;
    }

    drawGeometry(ctx, obj.geometry, transform, isFill, obj, layer);

    if (layer.settings.mode === 'engrave' && layer.settings.fill.enabled) {
      drawFillPreview(ctx, obj, layer, transform, isBurned ? '#6a8a6a' : modeColor);
    }
  } catch (err) {
    console.error('[Canvas] renderObject error:', obj.id, err);
  } finally {
    ctx.restore();
  }

  if (burnState && isRenderableAabb(worldBounds)) {
    if (isActive) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
      ctx.lineWidth = transform.screenPx(3);
      ctx.strokeRect(
        worldBounds.minX,
        worldBounds.minY,
        worldBounds.maxX - worldBounds.minX,
        worldBounds.maxY - worldBounds.minY,
      );
      ctx.restore();
    }
    if (isBurned) {
      ctx.save();
      ctx.font = `${transform.screenPx(10)}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(45, 212, 160, 0.8)';
      const burnedMarkerInset = transform.screenPx(2);
      ctx.fillText('\u2713', worldBounds.maxX - burnedMarkerInset, worldBounds.minY + burnedMarkerInset);
      ctx.restore();
    }
  }
}

/**
 * Draw parallel scanline preview inside an engrave object.
 * Uses canvas clipping to constrain lines to the object shape.
 * Text is skipped — rectangle-clipped scanlines misrepresent glyph-based fill.
 * Dense patterns are downsampled (every Nth line) so the preview is always visible.
 */
function drawFillPreview(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layer: Layer,
  transform: Transform,
  modeColor: string,
): void {
  const geom = obj.geometry;
  if (geom.type === 'image' || geom.type === 'line' || geom.type === 'text') return;

  const interval = layer.settings.fill.interval || 0.1;
  const angleDeg = layer.settings.fill.angle || 0;

  // Compute local-space bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const corners = getSceneObjectLocalCorners(geom);
  if (corners.length === 0) return;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return;

  // Downsample dense patterns so preview is always visible
  // Instead of hiding, show every Nth line to maintain min 3px visual gap
  let displayInterval = interval;
  const pxPerMm = 1 / transform.screenPx(1);
  while (displayInterval * pxPerMm < 3 && displayInterval < 100) {
    displayInterval *= 2;
  }

  // Cap total lines for performance
  const maxLines = 500;
  const diagonal = Math.sqrt(width * width + height * height);
  if (diagonal / displayInterval > maxLines) {
    displayInterval = diagonal / maxLines;
  }

  ctx.save();

  // Build clip path from object shape
  ctx.beginPath();
  if (geom.type === 'rect') {
    if (geom.cornerRadius > 0) {
      roundRect(ctx, geom.x, geom.y, geom.width, geom.height, Math.min(geom.cornerRadius, geom.width / 2, geom.height / 2));
    } else {
      ctx.rect(geom.x, geom.y, geom.width, geom.height);
    }
  } else if (geom.type === 'ellipse') {
    ctx.ellipse(geom.cx, geom.cy, geom.rx, geom.ry, 0, 0, Math.PI * 2);
  } else if (geom.type === 'polygon') {
    const pts = geom.points;
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (geom.closed) ctx.closePath();
    }
  } else if (geom.type === 'path') {
    for (const sub of geom.subPaths) {
      for (const seg of sub.segments) {
        if (seg.type === 'move') ctx.moveTo(seg.to.x, seg.to.y);
        else if (seg.type === 'line') ctx.lineTo(seg.to.x, seg.to.y);
        else if (seg.type === 'cubic') ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y);
        else if (seg.type === 'quadratic') ctx.quadraticCurveTo(seg.cp.x, seg.cp.y, seg.to.x, seg.to.y);
        else if (seg.type === 'close') ctx.closePath();
      }
    }
  }
  ctx.clip();

  // Draw scanlines — lighter opacity when downsampled to hint that actual pattern is denser
  const isDownsampled = displayInterval > interval * 1.5;
  ctx.strokeStyle = isDownsampled ? `${modeColor}20` : `${modeColor}30`;
  ctx.lineWidth = transform.screenPx(0.6);

  const angleRad = (angleDeg * Math.PI) / 180;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = diagonal + displayInterval;

  if (Math.abs(angleDeg % 180) < 0.01) {
    for (let y = minY + displayInterval / 2; y < maxY; y += displayInterval) {
      ctx.beginPath();
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
      ctx.stroke();
    }
  } else if (Math.abs((angleDeg - 90) % 180) < 0.01) {
    for (let x = minX + displayInterval / 2; x < maxX; x += displayInterval) {
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
      ctx.stroke();
    }
  } else {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    for (let d = -span / 2; d < span / 2; d += displayInterval) {
      const px = cx + d * sin;
      const py = cy - d * cos;
      const dx = span * cos;
      const dy = span * sin;
      ctx.beginPath();
      ctx.moveTo(px - dx, py - dy);
      ctx.lineTo(px + dx, py + dy);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// T1-138: getLocalCorners moved to ./sceneCornerHelpers as
// getSceneObjectLocalCorners so the geometry-type switch can be
// tested without loading the renderer module.

function drawObjectPath(ctx: CanvasRenderingContext2D, obj: SceneObject): void {
  const geom = obj.geometry as any;
  ctx.beginPath();

  if (geom.type === 'rect') {
    ctx.rect(geom.x, geom.y, geom.width, geom.height);
  } else if (geom.type === 'ellipse') {
    ctx.ellipse(geom.cx, geom.cy, geom.rx, geom.ry, 0, 0, Math.PI * 2);
  } else if (geom.type === 'line') {
    ctx.moveTo(geom.x1, geom.y1);
    ctx.lineTo(geom.x2, geom.y2);
  } else if (geom.type === 'path') {
    for (const sp of (geom.subPaths || [])) {
      for (const seg of sp.segments) {
        if (seg.type === 'move') ctx.moveTo(seg.to.x, seg.to.y);
        else if (seg.type === 'line') ctx.lineTo(seg.to.x, seg.to.y);
        else if (seg.type === 'cubic') ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y);
        else if (seg.type === 'quadratic') ctx.quadraticCurveTo(seg.cp.x, seg.cp.y, seg.to.x, seg.to.y);
        else if (seg.type === 'close') ctx.closePath();
      }
    }
  } else if (geom.type === 'polygon') {
    const pts = geom.points || [];
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (geom.closed) ctx.closePath();
    }
  } else if (geom.type === 'text') {
    ctx.fillStyle = ctx.strokeStyle as string;
    fillTextGeometry(ctx, geom as TextGeometry, 0, 0);
    return;
  }

  ctx.stroke();
}

function drawObjectFilled(ctx: CanvasRenderingContext2D, obj: SceneObject, fill: boolean): void {
  drawObjectPath(ctx, obj);
  if (fill) ctx.fill();
}

// ─── GEOMETRY DISPATCH ───────────────────────────────────────────

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  geom: Geometry,
  transform: Transform,
  fill: boolean,
  forObject?: SceneObject,
  layer?: Layer
): void {
  switch (geom.type) {
    case 'rect': {
      const rw = geom.width;
      const rh = geom.height;
      if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) break;
      ctx.beginPath();
      if (geom.cornerRadius > 0) {
        roundRect(ctx, geom.x, geom.y, rw, rh, geom.cornerRadius);
      } else {
        ctx.rect(geom.x, geom.y, rw, rh);
      }
      if (fill) ctx.fill();
      ctx.stroke();
      break;
    }

    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(geom.cx, geom.cy, Math.abs(geom.rx), Math.abs(geom.ry), 0, 0, Math.PI * 2);
      if (fill) ctx.fill();
      ctx.stroke();
      break;

    case 'line':
      ctx.beginPath();
      ctx.moveTo(geom.x1, geom.y1);
      ctx.lineTo(geom.x2, geom.y2);
      ctx.stroke();
      break;

    case 'polygon':
      if (geom.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(geom.points[0].x, geom.points[0].y);
      for (let i = 1; i < geom.points.length; i++) {
        ctx.lineTo(geom.points[i].x, geom.points[i].y);
      }
      if (geom.closed) ctx.closePath();
      if (fill) ctx.fill();
      ctx.stroke();
      break;

    case 'path':
      for (const sub of geom.subPaths) {
        ctx.beginPath();
        for (const seg of sub.segments) {
          const fin = (p: { x: number; y: number } | undefined) =>
            p && Number.isFinite(p.x) && Number.isFinite(p.y);
          switch (seg.type) {
            case 'move':
              if (fin(seg.to)) ctx.moveTo(seg.to.x, seg.to.y);
              break;
            case 'line':
              if (fin(seg.to)) ctx.lineTo(seg.to.x, seg.to.y);
              break;
            case 'cubic':
              if (fin(seg.cp1) && fin(seg.cp2) && fin(seg.to)) {
                ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y);
              }
              break;
            case 'quadratic':
              if (fin(seg.cp) && fin(seg.to)) {
                ctx.quadraticCurveTo(seg.cp.x, seg.cp.y, seg.to.x, seg.to.y);
              }
              break;
            case 'close':
              ctx.closePath(); break;
          }
        }
        if (fill) ctx.fill();
        ctx.stroke();
      }
      break;

    case 'text': {
      ctx.save();
      ctx.fillStyle = typeof ctx.strokeStyle === 'string' ? ctx.strokeStyle : '#ffffff';
      fillTextGeometry(ctx, geom, 0, 0);
      ctx.restore();
      return;
    }

    case 'image': {
      if (!forObject) break;

      if ((geom as ImageGeometry).missingSource === true) {
        const dpi = 96;
        const physicalWidth = (geom.originalWidth / dpi) * 25.4;
        const physicalHeight = (geom.originalHeight / dpi) * 25.4;
        ctx.save();
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, physicalWidth, physicalHeight);
        ctx.lineWidth = transform.screenPx(1);
        ctx.strokeStyle = '#ff4466';
        ctx.strokeRect(0, 0, physicalWidth, physicalHeight);
        ctx.fillStyle = '#ff88a0';
        ctx.font = `${transform.screenPx(10)}px monospace`;
        ctx.fillText('Missing image', transform.screenPx(4), physicalHeight / 2);
        ctx.restore();
        break;
      }

      let loadSrc = geom.src;
      if (geom.src.startsWith('indexeddb://')) {
        const resolved = getIdbResolved(geom.src);
        if (resolved) {
          loadSrc = resolved;
        } else {
          if (!idbPendingSrc.has(geom.src)) {
            idbPendingSrc.add(geom.src);
            const rawId = geom.src.slice('indexeddb://'.length);
            const srcKey = geom.src;
            void getImageRenderSrc(rawId).then(uri => {
              idbPendingSrc.delete(srcKey);
              if (uri) {
                setIdbResolved(srcKey, uri);
                dispatchCanvasRepaint();
              }
            });
          }
          const dpi = 96;
          const physicalWidth = (geom.originalWidth / dpi) * 25.4;
          const physicalHeight = (geom.originalHeight / dpi) * 25.4;
          ctx.save();
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, physicalWidth, physicalHeight);
          ctx.lineWidth = transform.screenPx(1);
          ctx.strokeRect(0, 0, physicalWidth, physicalHeight);
          ctx.fillStyle = '#666';
          ctx.font = `${transform.screenPx(10)}px monospace`;
          ctx.fillText('Loading...', transform.screenPx(4), physicalHeight / 2);
          ctx.restore();
          break;
        }
      }

      const img = getOrCreateImage(loadSrc);

      if (img.complete && img.naturalWidth > 0) {
        const dpi = 96;
        const physicalWidth = (geom.originalWidth / dpi) * 25.4;
        const physicalHeight = (geom.originalHeight / dpi) * 25.4;

        ctx.save();
        const ims = layer?.settings.mode === 'image' ? layer.settings.image : undefined;
        const brightness = ims?.brightness ?? (geom as ImageGeometry).brightness ?? 0;
        const contrast = ims?.contrast ?? (geom as ImageGeometry).contrast ?? 0;
        const invert = ims?.invert ?? (geom as ImageGeometry).invert ?? false;

        const brightnessVal = 1 + brightness / 100;
        const contrastVal = 1 + contrast / 100;

        let filterStr = `brightness(${brightnessVal}) contrast(${contrastVal})`;
        if (invert) filterStr += ' invert(1)';
        ctx.filter = filterStr;

        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, 0, 0, physicalWidth, physicalHeight);
        ctx.filter = 'none';
        ctx.restore();

        // Dithered preview with caching (layer-driven raster mode)
        const ditherMode = ims?.imageMode === 'dither' ? ims.dithering : undefined;
        const adjustedData = (geom as ImageGeometry).adjustedData;
        if (ditherMode && ditherMode !== 'none' && adjustedData && geom.grayscaleWidth && geom.grayscaleHeight) {
          const ditherKey = buildDitherCacheKey(loadSrc, geom.grayscaleWidth, geom.grayscaleHeight, ditherMode, adjustedData);
          let ditherCanvas = ditherCacheGet(ditherKey);

          if (!ditherCanvas) {
            const dw = geom.grayscaleWidth;
            const dh = geom.grayscaleHeight;
            const offscreen = document.createElement('canvas');
            offscreen.width = dw;
            offscreen.height = dh;
            const offCtx = offscreen.getContext('2d');
            if (offCtx) {
              const imgData = offCtx.createImageData(dw, dh);
              for (let i = 0; i < adjustedData.length; i++) {
                const color = adjustedData[i] > 128 ? 0 : 255;
                imgData.data[i * 4] = color;
                imgData.data[i * 4 + 1] = color;
                imgData.data[i * 4 + 2] = color;
                imgData.data[i * 4 + 3] = 255;
              }
              offCtx.putImageData(imgData, 0, 0);
              ditherCacheSet(ditherKey, offscreen);
              ditherCanvas = offscreen;
            }
          }

          if (ditherCanvas) {
            ctx.drawImage(ditherCanvas, 0, 0, physicalWidth, physicalHeight);
          }
        }

        ctx.lineWidth = transform.screenPx(1);
        ctx.strokeRect(0, 0, physicalWidth, physicalHeight);
      } else {
        // Placeholder while loading
        const dpi = 96;
        const physicalWidth = (geom.originalWidth / dpi) * 25.4;
        const physicalHeight = (geom.originalHeight / dpi) * 25.4;
        ctx.save();
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, physicalWidth, physicalHeight);
        ctx.lineWidth = transform.screenPx(1);
        ctx.strokeRect(0, 0, physicalWidth, physicalHeight);
        ctx.fillStyle = '#666';
        ctx.font = `${transform.screenPx(10)}px monospace`;
        ctx.fillText('Loading...', transform.screenPx(4), physicalHeight / 2);
        ctx.restore();
      }
      break;
    }
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || !Number.isFinite(r)) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}

// ─── SELECTION HIGHLIGHT ─────────────────────────────────────────

function renderSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  bounds: AABB,
  transform: Transform
): void {
  const { minX, minY, maxX, maxY } = bounds;
  const w = maxX - minX;
  const h = maxY - minY;

  // Bounding box — blue dashed
  ctx.strokeStyle = '#3b8beb';
  ctx.lineWidth = transform.screenPx(1);
  ctx.setLineDash([transform.screenPx(4), transform.screenPx(3)]);
  ctx.strokeRect(minX, minY, w, h);
  ctx.setLineDash([]);
  // Resize handles drawn in CanvasViewport (screen-consistent hit targets)
}
