// Paints the operation colour pulse (ADR-620) on its own pointer-transparent
// canvas above the workspace, so a pulse never redraws the scene. Each piece's
// colour geometry is rendered once into a small bitmap; every frame then only
// blits it at the pulse strength, and blits a blurred outline copy for the
// glow and the soft edge. The outline is grown from the bitmap itself, so its
// cost follows the piece's pixels, not its segment count: a dense trace is
// painted once per hover, never stroked again for the glow.

import {
  applyTransform,
  operationIdsForObject,
  pathUsesOperation,
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
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import {
  isVectorSceneObject,
  paintObjectDisplay,
  resolveObjectDisplay,
  type VectorSceneObject,
} from './object-display';
import type { ViewTransform } from './view-transform';

/** How far the glow outline is grown out from the artwork, in pixels. */
const GLOW_OUTLINE_GROW_PX = 2.5;
const GLOW_GROW_OFFSETS: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: 8 },
  (_, index) => {
    const angle = (index * Math.PI) / 4;
    return [GLOW_OUTLINE_GROW_PX * Math.cos(angle), GLOW_OUTLINE_GROW_PX * Math.sin(angle)];
  },
);
/** Room around a piece for that outline and the antialiased edge. */
const BITMAP_PAD_PX = 8;
/** Recent pieces kept after their pulse ends, so pointing again is instant. */
const RETAINED_PIECES = 8;
/** About 64 MB of RGBA pixels; live pieces are kept even above this budget. */
const RETAINED_PIXELS = 16_000_000;
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
  /** Other bound operations can change the path's visible fill/stroke style. */
  readonly lookup: ReadonlyMap<string, Layer>;
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
  private layers: ReadonlyArray<Layer> | undefined;
  private objects: ReadonlyArray<SceneObject> | undefined;
  private layerById = new Map<string, Layer>();
  private objectById = new Map<string, SceneObject>();
  private lookup: ReadonlyMap<string, Layer> = new Map();
  private readonly displayCache = createDisplayPolylineCache();
  private readonly objectOperations = new WeakMap<
    SceneObject,
    { readonly layers: ReadonlyArray<Layer>; readonly ids: ReadonlyArray<string> }
  >();

  draw(
    ctx: CanvasRenderingContext2D,
    project: Project,
    view: ViewTransform,
    pieces: ReadonlyArray<PulsePieceFrame>,
  ): void {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    const layers = project.scene.layers;
    this.indexScene(project);
    const { layerById, objectById, lookup } = this;
    const viewKey = `${view.scale}|${view.offsetX}|${view.offsetY}|${width}x${height}|${getCanvasColorScheme()}`;
    const live = new Set<string>();
    for (const piece of pieces) {
      const object = objectById.get(piece.objectId);
      if (object === undefined) continue;
      // Only the piece's own operations: a group of N same-settings imports
      // carries N operations, and pairing every piece with every one of them
      // would render N² empty bitmaps.
      for (const operationId of this.operationsOf(object, layers)) {
        const sourceId = piece.colorSources.get(operationId);
        const layer = layerById.get(operationId);
        if (sourceId === undefined || layer === undefined || !layer.visible) continue;
        const colorLayer = layerById.get(sourceId) ?? layer;
        const key = `${object.id}\u0000${operationId}`;
        live.add(key);
        const identity = { object, layer, colorLayer, lookup, viewKey };
        const bitmap = this.bitmapFor(key, identity, lookup, view, ctx.canvas);
        if (bitmap !== null) drawPiece(ctx, bitmap, piece);
      }
    }
    this.retain(live);
  }

  /** Immutable scene arrays let animation frames reuse their scene-wide indexes. */
  private indexScene(project: Project): void {
    const { layers, objects } = project.scene;
    if (layers !== this.layers) {
      this.layers = layers;
      this.layerById = new Map(layers.map((layer) => [layer.id, layer]));
      this.lookup = sceneLayerVisibility.lookup(layers);
    }
    if (objects !== this.objects) {
      this.objects = objects;
      this.objectById = new Map(objects.map((object) => [object.id, object]));
    }
  }

  /** The operations an object's artwork uses, kept until the object or the operations change. */
  private operationsOf(object: SceneObject, layers: ReadonlyArray<Layer>): ReadonlyArray<string> {
    const cached = this.objectOperations.get(object);
    if (cached?.layers === layers) return cached.ids;
    const ids = operationIdsForObject(object, layers);
    this.objectOperations.set(object, { layers, ids });
    return ids;
  }

  /** Keep every live piece and the most recently used others, oldest out first. */
  private retain(live: ReadonlySet<string>): void {
    let spare = RETAINED_PIECES;
    let pixels = RETAINED_PIXELS;
    for (const key of live) pixels -= bitmapPixels(this.entries.get(key)?.bitmap);
    for (const key of [...this.entries.keys()].reverse()) {
      if (live.has(key)) continue;
      const bitmap = this.entries.get(key)?.bitmap;
      const size = bitmapPixels(bitmap);
      if (spare > 0 && size <= pixels) {
        spare -= 1;
        pixels -= size;
      } else {
        this.entries.delete(key);
        // Release the backing stores immediately, without waiting for canvas GC.
        if (bitmap != null) {
          bitmap.flood.width = 0;
          bitmap.glow.width = 0;
        }
      }
    }
  }

  private bitmapFor(
    key: string,
    identity: Omit<CacheEntry, 'bitmap'>,
    lookup: ReadonlyMap<string, Layer>,
    view: ViewTransform,
    canvas: HTMLCanvasElement,
  ): PieceBitmap | null {
    const cached = this.entries.get(key);
    // Re-inserting marks the entry most recently used for `retain`.
    this.entries.delete(key);
    if (
      cached !== undefined &&
      cached.object === identity.object &&
      cached.layer === identity.layer &&
      cached.colorLayer === identity.colorLayer &&
      cached.lookup === identity.lookup &&
      cached.viewKey === identity.viewKey
    ) {
      this.entries.set(key, cached);
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

function bitmapPixels(bitmap: PieceBitmap | null | undefined): number {
  return bitmap == null
    ? 0
    : bitmap.flood.width * bitmap.flood.height + bitmap.glow.width * bitmap.glow.height;
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
  if (isVectorSceneObject(object)) {
    if (!paintVectorPiece(object, layer, color, lookup, local, displayCache, flood.ctx)) {
      return null;
    }
    growOutline(glow.ctx, flood.canvas);
  } else if (!paintFramePiece(object, layer, local, color, flood.ctx, glow.ctx)) {
    return null;
  }
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
): boolean {
  const resolved = resolveObjectDisplay(object, lookup, view, displayCache, 'design', 'operation');
  // Every operation bound to a path, not only the one that styles it on the
  // canvas, so each operation's row can reveal the artwork it processes.
  const paths = resolved.paths
    .filter((display) => pathUsesOperation(object, display.path, layer))
    .map((display) => ({ ...display, paint: { ...display.paint, color } }));
  if (paths.length === 0) return false;
  paintObjectDisplay(flood, object, { ...resolved, paths }, view);
  return true;
}

/**
 * The band just outside and inside the artwork's edge: the colour bitmap
 * smeared a few pixels in every direction, less the bitmap itself. A filled
 * shape's interior drops out, so its edge glows without tinting the fill.
 */
function growOutline(glow: CanvasRenderingContext2D, flood: HTMLCanvasElement): void {
  for (const [dx, dy] of GLOW_GROW_OFFSETS) glow.drawImage(flood, dx, dy);
  glow.globalCompositeOperation = 'destination-out';
  glow.drawImage(flood, 0, 0);
  glow.globalCompositeOperation = 'source-over';
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
  glow.lineWidth = FRAME_LINE_PX + 2 * GLOW_OUTLINE_GROW_PX;
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
