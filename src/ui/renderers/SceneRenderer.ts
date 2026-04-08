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
import { type SceneObject, type Geometry } from '../../core/scene/SceneObject';
import { type Layer } from '../../core/scene/Layer';
import { type Transform } from '../viewport';
import { type AABB, aabbIntersects } from '../../core/types';
import { computeObjectBounds } from '../../geometry/bounds';

// ─── MAIN RENDER ─────────────────────────────────────────────────

/** Bed, grid, origin, crosshair — leaves ctx with transform applied (outer save still active). */
export function renderSceneBackground(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  transform.applyToContext(ctx);

  renderBed(ctx, scene.canvas.width, scene.canvas.height, transform);
  renderGrid(ctx, scene.canvas.width, scene.canvas.height, transform);
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

/** Objects + selection highlights + restores outer ctx.save from renderSceneBackground. */
export function renderSceneObjects(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  selectedIds?: ReadonlySet<string>
): void {
  const visibleBounds = transform.getVisibleWorldBounds(canvasWidth, canvasHeight);

  const layerMap = new Map<string, Layer>();
  for (const layer of scene.layers) {
    layerMap.set(layer.id, layer);
  }

  const boundsCache = selectedIds && selectedIds.size > 0
    ? new Map<string, AABB>()
    : null;

  for (const obj of scene.objects) {
    const layer = layerMap.get(obj.layerId);
    if (!layer || !layer.visible) continue;

    const objBounds = computeObjectBounds(obj);
    if (!aabbIntersects(objBounds, visibleBounds)) continue;

    if (boundsCache && selectedIds!.has(obj.id)) {
      boundsCache.set(obj.id, objBounds);
    }

    renderObject(ctx, obj, layer, transform);
  }

  if (boundsCache && boundsCache.size > 0) {
    for (const [id, bounds] of boundsCache) {
      renderSelectionHighlight(ctx, bounds, transform);
    }
  }

  ctx.restore();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  transform: Transform,
  canvasWidth: number,
  canvasHeight: number,
  selectedIds?: ReadonlySet<string>
): void {
  renderSceneBackground(ctx, scene, transform, canvasWidth, canvasHeight);
  renderSceneObjects(ctx, scene, transform, canvasWidth, canvasHeight, selectedIds);
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

function renderObject(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layer: Layer,
  transform: Transform
): void {
  ctx.save();

  // Apply object transform
  const t = obj.transform;
  ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);

  ctx.strokeStyle = layer.color;
  ctx.lineWidth = transform.screenPx(1.2);

  const isFill = layer.settings.mode === 'engrave' || layer.settings.mode === 'image';
  if (isFill) {
    ctx.fillStyle = layer.color + '15';
  }

  drawGeometry(ctx, obj.geometry, transform, isFill, obj);

  ctx.restore();
}

// ─── GEOMETRY DISPATCH ───────────────────────────────────────────

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  geom: Geometry,
  transform: Transform,
  fill: boolean,
  forObject?: SceneObject
): void {
  switch (geom.type) {
    case 'rect':
      ctx.beginPath();
      if (geom.cornerRadius > 0) {
        roundRect(ctx, geom.x, geom.y, geom.width, geom.height, geom.cornerRadius);
      } else {
        ctx.rect(geom.x, geom.y, geom.width, geom.height);
      }
      if (fill) ctx.fill();
      ctx.stroke();
      break;

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
          switch (seg.type) {
            case 'move':
              ctx.moveTo(seg.to.x, seg.to.y); break;
            case 'line':
              ctx.lineTo(seg.to.x, seg.to.y); break;
            case 'cubic':
              ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y); break;
            case 'quadratic':
              ctx.quadraticCurveTo(seg.cp.x, seg.cp.y, seg.to.x, seg.to.y); break;
            case 'close':
              ctx.closePath(); break;
          }
        }
        if (fill) ctx.fill();
        ctx.stroke();
      }
      break;

    case 'text': {
      const textGeom = geom;
      const fontSize = textGeom.fontSize || 10;
      const fontFamily = textGeom.fontFamily || 'Arial';
      const bold = textGeom.bold ? 'bold ' : '';
      const italic = textGeom.italic ? 'italic ' : '';

      ctx.save();
      ctx.font = `${italic}${bold}${fontSize}px ${fontFamily}`;
      ctx.fillStyle = typeof ctx.strokeStyle === 'string' ? ctx.strokeStyle : '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(textGeom.text, 0, 0);
      ctx.restore();
      return;
    }

    case 'image': {
      if (!forObject) break;
      const renderObject = forObject;
      // Load and cache images for rendering
      const imgCache = (renderObject as { _imgCache?: Map<string, HTMLImageElement> })._imgCache || new Map<string, HTMLImageElement>();
      (renderObject as { _imgCache?: Map<string, HTMLImageElement> })._imgCache = imgCache;

      let img = imgCache.get(geom.src);
      if (!img) {
        img = new Image();
        img.src = geom.src;
        imgCache.set(geom.src, img);
        img.onload = () => {
          // Image loaded — canvas will update on next render cycle.
          // Dispatch a resize event to trigger a re-render.
          window.dispatchEvent(new Event('resize'));
        };
      }

      if (img.complete && img.naturalWidth > 0) {
        const dpi = 96;
        const physicalWidth = (geom.originalWidth / dpi) * 25.4;
        const physicalHeight = (geom.originalHeight / dpi) * 25.4;

        ctx.save();
        // Apply image processing filters
        const brightness = (geom as any).brightness || 0;
        const contrast = (geom as any).contrast || 0;
        const invert = (geom as any).invert || false;

        const brightnessVal = 1 + brightness / 100;
        const contrastVal = 1 + contrast / 100;

        let filterStr = `brightness(${brightnessVal}) contrast(${contrastVal})`;
        if (invert) filterStr += ' invert(1)';
        ctx.filter = filterStr;

        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, 0, 0, physicalWidth, physicalHeight);
        ctx.filter = 'none';
        ctx.restore();

        // Dithered preview with caching
        const ditherMode = (geom as any).ditherMode;
        const adjustedData = (geom as any).adjustedData;
        if (ditherMode && ditherMode !== 'none' && adjustedData && geom.grayscaleWidth && geom.grayscaleHeight) {
          const cacheKey = `dither_${geom.grayscaleWidth}_${geom.grayscaleHeight}_${ditherMode}_${adjustedData.length}`;
          let cached = (renderObject as any)._ditherCache as { key: string; canvas: HTMLCanvasElement } | undefined;

          if (!cached || cached.key !== cacheKey) {
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
              cached = { key: cacheKey, canvas: offscreen };
              (renderObject as any)._ditherCache = cached;
            }
          }

          if (cached) {
            ctx.drawImage(cached.canvas, 0, 0, physicalWidth, physicalHeight);
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
