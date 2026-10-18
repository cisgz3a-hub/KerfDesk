// Paints the operation colour pulse (ADR-620) on its own pointer-transparent
// canvas above the workspace, so a pulse never redraws the scene. Each piece's
// colour geometry is rendered once into a small bitmap; every frame then only
// blits it at the pulse strength, and blits a blurred outline copy for the
// glow and the soft edge.

import {
  applyTransform,
  sceneLayerVisibility,
  sceneObjectUsesOperation,
  transformedBBox,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { getCanvasColorScheme } from '../theme/canvas-color-scheme';
import { canvasVectorDisplayColor } from '../theme/canvas-vector-color';
import { PULSE_EDGE_BLUR_PX, type PulsePieceFrame } from './artwork-pulse';
import { artworkStrokeWidthPx } from './draw-complexity';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { strokePolylinesBatched } from './draw-vector-strokes';
import {
  isVectorSceneObject,
  paintObjectDisplay,
  resolveObjectDisplay,
  type VectorSceneObject,
} from './object-display';
import type { ViewTransform } from './view-transform';

/** The glow is cast by an outline this much wider than the artwork's own line. */
const GLOW_OUTLINE_EXTRA_PX = 5;
/** Room around a piece for that outline and the antialiased edge. */
const BITMAP_PAD_PX = 8;
/** Raster and relief artwork pulse as a tinted frame: tint strength and outline width. */
const FRAME_TINT_ALPHA = 0.28;
const FRAME_LINE_PX = 2;

type PieceBitmap = {
  readonly color: string;
  readonly left: number;
  readonly top: number;
  readonly flood: HTMLCanvasElement;
  readonly glow: HTMLCanvasElement;
};

type CacheEntry = {
  readonly object: SceneObject;
  /** The operation whose artwork is drawn… */
  readonly layer: Layer;
  /** …in this operation's colour (the one the pointer is on). */
  readonly colorLayer: Layer;
  readonly viewKey: string;
  readonly bitmap: PieceBitmap | null;
};

type Region = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export class ArtworkPulsePainter {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly displayCache = createDisplayPolylineCache();

  draw(
    ctx: CanvasRenderingContext2D,
    project: Project,
    view: ViewTransform,
    pieces: ReadonlyArray<PulsePieceFrame>,
  ): void {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    const layers = project.scene.layers;
    const layerById = new Map(layers.map((layer) => [layer.id, layer]));
    const objectById = new Map(project.scene.objects.map((object) => [object.id, object]));
    const lookup = sceneLayerVisibility.lookup(layers);
    const viewKey = `${view.scale}|${view.offsetX}|${view.offsetY}|${width}x${height}|${getCanvasColorScheme()}`;
    const live = new Set<string>();
    for (const piece of pieces) {
      const object = objectById.get(piece.objectId);
      if (object === undefined) continue;
      for (const [operationId, sourceId] of piece.colorSources) {
        const layer = layerById.get(operationId);
        if (layer === undefined || !layer.visible) continue;
        const colorLayer = layerById.get(sourceId) ?? layer;
        const key = `${object.id}\u0000${operationId}`;
        live.add(key);
        const identity = { object, layer, colorLayer, viewKey };
        const bitmap = this.bitmapFor(key, identity, lookup, view, ctx.canvas);
        if (bitmap !== null) drawPiece(ctx, bitmap, piece);
      }
    }
    for (const key of this.entries.keys()) if (!live.has(key)) this.entries.delete(key);
  }

  private bitmapFor(
    key: string,
    identity: Omit<CacheEntry, 'bitmap'>,
    lookup: ReadonlyMap<string, Layer>,
    view: ViewTransform,
    canvas: HTMLCanvasElement,
  ): PieceBitmap | null {
    const cached = this.entries.get(key);
    if (
      cached !== undefined &&
      cached.object === identity.object &&
      cached.layer === identity.layer &&
      cached.colorLayer === identity.colorLayer &&
      cached.viewKey === identity.viewKey
    ) {
      return cached.bitmap;
    }
    const color = canvasVectorDisplayColor(identity.colorLayer.color);
    const bitmap = renderPiece(
      identity.object,
      identity.layer,
      color,
      lookup,
      view,
      canvas,
      this.displayCache,
    );
    this.entries.set(key, { ...identity, bitmap });
    return bitmap;
  }
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  bitmap: PieceBitmap,
  piece: PulsePieceFrame,
): void {
  ctx.save();
  const edge = piece.edgeAlpha > 0 ? { blurPx: PULSE_EDGE_BLUR_PX, alpha: piece.edgeAlpha } : null;
  // Draw the outline far off to the left and let only its shadow land on the
  // piece: the shadow is the blurred glow, without a hard copy of the outline.
  const shift = ctx.canvas.width + bitmap.glow.width + 64;
  for (const glow of [piece.glow, edge]) {
    if (glow === null) continue;
    ctx.globalAlpha = glow.alpha;
    ctx.shadowColor = bitmap.color;
    ctx.shadowBlur = glow.blurPx;
    ctx.shadowOffsetX = shift;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(bitmap.glow, bitmap.left - shift, bitmap.top);
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  if (piece.strength > 0) {
    ctx.globalAlpha = piece.strength;
    ctx.drawImage(bitmap.flood, bitmap.left, bitmap.top);
  }
  ctx.restore();
}

function renderPiece(
  object: SceneObject,
  layer: Layer,
  color: string,
  lookup: ReadonlyMap<string, Layer>,
  view: ViewTransform,
  canvas: HTMLCanvasElement,
  displayCache: DisplayPolylineCache,
): PieceBitmap | null {
  const region = screenRegion(object, view, canvas);
  if (region === null) return null;
  const local: ViewTransform = {
    scale: view.scale,
    offsetX: view.offsetX - region.left,
    offsetY: view.offsetY - region.top,
  };
  const flood = createBitmap(region);
  const glow = createBitmap(region);
  if (flood === null || glow === null) return null;
  const painted = isVectorSceneObject(object)
    ? paintVectorPiece(object, layer, color, lookup, local, displayCache, flood.ctx, glow.ctx)
    : paintFramePiece(object, layer, local, color, flood.ctx, glow.ctx);
  if (!painted) return null;
  return { color, left: region.left, top: region.top, flood: flood.canvas, glow: glow.canvas };
}

function paintVectorPiece(
  object: VectorSceneObject,
  layer: Layer,
  color: string,
  lookup: ReadonlyMap<string, Layer>,
  view: ViewTransform,
  displayCache: DisplayPolylineCache,
  flood: CanvasRenderingContext2D,
  glow: CanvasRenderingContext2D,
): boolean {
  const resolved = resolveObjectDisplay(object, lookup, view, displayCache, 'design', 'operation');
  const paths = resolved.paths
    .filter((path) => path.operationId === layer.id)
    .map((path) => ({ ...path, paint: { ...path.paint, color } }));
  if (paths.length === 0) return false;
  paintObjectDisplay(flood, object, { ...resolved, paths }, view);
  glow.lineJoin = 'round';
  glow.lineCap = 'round';
  glow.strokeStyle = color;
  for (const { display, paint } of paths) {
    glow.lineWidth =
      artworkStrokeWidthPx(resolved.displaySegmentCount, paint.output) + GLOW_OUTLINE_EXTRA_PX;
    strokePolylinesBatched(glow, object, display.polylines, view);
  }
  return true;
}

function paintFramePiece(
  object: SceneObject,
  layer: Layer,
  view: ViewTransform,
  color: string,
  flood: CanvasRenderingContext2D,
  glow: CanvasRenderingContext2D,
): boolean {
  if (!sceneObjectUsesOperation(object, layer)) return false;
  const corners = objectCorners(object).map((point) => ({
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY + point.y * view.scale,
  }));
  traceClosed(flood, corners);
  flood.fillStyle = color;
  flood.globalAlpha = FRAME_TINT_ALPHA;
  flood.fill();
  flood.globalAlpha = 1;
  flood.strokeStyle = color;
  flood.lineWidth = FRAME_LINE_PX;
  flood.stroke();
  traceClosed(glow, corners);
  glow.strokeStyle = color;
  glow.lineJoin = 'round';
  glow.lineWidth = FRAME_LINE_PX + GLOW_OUTLINE_EXTRA_PX;
  glow.stroke();
  return true;
}

function objectCorners(object: SceneObject): ReadonlyArray<Vec2> {
  const { minX, minY, maxX, maxY } = object.bounds;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((point) => applyTransform(point, object.transform));
}

function traceClosed(ctx: CanvasRenderingContext2D, points: ReadonlyArray<Vec2>): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

/** The piece's on-screen box plus padding, clipped to the visible canvas. */
function screenRegion(
  object: SceneObject,
  view: ViewTransform,
  canvas: HTMLCanvasElement,
): Region | null {
  const box = transformedBBox(object);
  const left = Math.max(
    -BITMAP_PAD_PX,
    Math.floor(view.offsetX + box.minX * view.scale) - BITMAP_PAD_PX,
  );
  const top = Math.max(
    -BITMAP_PAD_PX,
    Math.floor(view.offsetY + box.minY * view.scale) - BITMAP_PAD_PX,
  );
  const right = Math.min(
    canvas.width + BITMAP_PAD_PX,
    Math.ceil(view.offsetX + box.maxX * view.scale) + BITMAP_PAD_PX,
  );
  const bottom = Math.min(
    canvas.height + BITMAP_PAD_PX,
    Math.ceil(view.offsetY + box.maxY * view.scale) + BITMAP_PAD_PX,
  );
  if (!(right > left && bottom > top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function createBitmap(
  region: Region,
): { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const ctx = canvas.getContext('2d');
  return ctx === null ? null : { canvas, ctx };
}
