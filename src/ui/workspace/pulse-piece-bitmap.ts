// One piece's pulse bitmaps (ADR-620, ADR-632 Amendment 1): its colour
// geometry, and two soft halos blurred once from its outline. Frames only blit
// these at an alpha, so a pulse across many pieces costs no blur per frame.
// The outline is grown from the colour bitmap itself, so its cost follows the
// piece's pixels, not its segment count: a dense trace is painted once per
// hover, never stroked again for the glow.

import {
  applyTransform,
  pathUsesOperation,
  sceneObjectUsesOperation,
  transformedBBox,
  type Layer,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { PULSE_BLOOM_BLUR_PX, PULSE_EDGE_BLUR_PX } from './artwork-pulse';
import type { DisplayPolylineCache } from './display-polylines';
import {
  isVectorSceneObject,
  paintObjectDisplay,
  resolveObjectDisplay,
  type ObjectDisplayMode,
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
/** A canvas shadow blur reaches about 1.5 times its blur value before it fades out. */
const SHADOW_REACH = 1.5;
/** Raster and relief artwork pulse as a tinted frame: tint strength and outline width. */
const FRAME_TINT_ALPHA = 0.28;
const FRAME_LINE_PX = 2;

/** A bitmap and where its top-left sat on the overlay for the view it was rendered at. */
export type PlacedBitmap = {
  readonly canvas: HTMLCanvasElement;
  readonly left: number;
  readonly top: number;
};

export type PieceBitmap = {
  readonly color: string;
  /** The view these were rendered for. */
  readonly view: ViewTransform;
  /** Not cut at the overlay's edge, so a pan can move them as they are. */
  readonly whole: boolean;
  readonly flood: PlacedBitmap;
  /** Tight halo for the resting edge. */
  readonly edge: PlacedBitmap;
  /** Wide halo for the pulse's glow. */
  readonly bloom: PlacedBitmap;
};

type Region = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** The padded box fits on the overlay uncut. */
  readonly whole: boolean;
};

export function renderPieceBitmap(args: {
  readonly object: SceneObject;
  readonly layer: Layer;
  readonly color: string;
  readonly lookup: ReadonlyMap<string, Layer>;
  readonly view: ViewTransform;
  readonly canvas: HTMLCanvasElement;
  readonly displayCache: DisplayPolylineCache;
  readonly displayMode: ObjectDisplayMode;
}): PieceBitmap | null {
  const { object, layer, color, view } = args;
  const region = screenRegion(object, view, args.canvas);
  if (region === null) return null;
  const local: ViewTransform = {
    scale: view.scale,
    offsetX: view.offsetX - region.left,
    offsetY: view.offsetY - region.top,
  };
  const flood = createBitmap(region.width, region.height);
  const outline = createBitmap(region.width, region.height);
  if (flood === null || outline === null) return null;
  if (isVectorSceneObject(object)) {
    const painted = paintVectorPiece(object, layer, color, args, local, flood.ctx);
    if (!painted) return null;
    growOutline(outline.ctx, flood.canvas);
  } else if (!paintFramePiece(object, layer, local, color, flood.ctx, outline.ctx)) {
    return null;
  }
  const placedOutline = { canvas: outline.canvas, left: region.left, top: region.top };
  const edge = blurredHalo(placedOutline, color, PULSE_EDGE_BLUR_PX);
  const bloom = blurredHalo(placedOutline, color, PULSE_BLOOM_BLUR_PX);
  // Release the outline's backing store at once: only its halos are drawn.
  outline.canvas.width = 0;
  if (edge === null || bloom === null) return null;
  return {
    color,
    view,
    whole: region.whole,
    flood: { canvas: flood.canvas, left: region.left, top: region.top },
    edge,
    bloom,
  };
}

/** Whether the piece's bitmaps would land on the overlay in this view. */
export function pieceInView(
  object: SceneObject,
  view: ViewTransform,
  canvas: { readonly width: number; readonly height: number },
): boolean {
  return screenRegion(object, view, canvas) !== null;
}

export function pieceBitmapPixels(bitmap: PieceBitmap | null | undefined): number {
  if (bitmap == null) return 0;
  return [bitmap.flood, bitmap.edge, bitmap.bloom].reduce(
    (sum, placed) => sum + placed.canvas.width * placed.canvas.height,
    0,
  );
}

/** Release the backing stores immediately, without waiting for canvas GC. */
export function releasePieceBitmap(bitmap: PieceBitmap | null | undefined): void {
  if (bitmap == null) return;
  bitmap.flood.canvas.width = 0;
  bitmap.edge.canvas.width = 0;
  bitmap.bloom.canvas.width = 0;
}

function paintVectorPiece(
  object: VectorSceneObject,
  layer: Layer,
  color: string,
  args: {
    readonly lookup: ReadonlyMap<string, Layer>;
    readonly displayCache: DisplayPolylineCache;
    readonly displayMode: ObjectDisplayMode;
  },
  view: ViewTransform,
  flood: CanvasRenderingContext2D,
): boolean {
  const resolved = resolveObjectDisplay(
    object,
    args.lookup,
    view,
    args.displayCache,
    args.displayMode,
    'operation',
  );
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

/**
 * The outline blurred once into its own, larger bitmap. It is drawn far off
 * to the left so that only its shadow lands: the blur without a hard copy.
 */
function blurredHalo(outline: PlacedBitmap, color: string, blurPx: number): PlacedBitmap | null {
  const reach = Math.ceil(blurPx * SHADOW_REACH);
  const halo = createBitmap(outline.canvas.width + 2 * reach, outline.canvas.height + 2 * reach);
  if (halo === null) return null;
  const shift = halo.canvas.width + outline.canvas.width + 64;
  halo.ctx.shadowColor = color;
  halo.ctx.shadowBlur = blurPx;
  halo.ctx.shadowOffsetX = shift;
  halo.ctx.drawImage(outline.canvas, reach - shift, reach);
  return { canvas: halo.canvas, left: outline.left - reach, top: outline.top - reach };
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
  canvas: { readonly width: number; readonly height: number },
): Region | null {
  const box = transformedBBox(object);
  const fullLeft = Math.floor(view.offsetX + box.minX * view.scale) - BITMAP_PAD_PX;
  const fullTop = Math.floor(view.offsetY + box.minY * view.scale) - BITMAP_PAD_PX;
  const fullRight = Math.ceil(view.offsetX + box.maxX * view.scale) + BITMAP_PAD_PX;
  const fullBottom = Math.ceil(view.offsetY + box.maxY * view.scale) + BITMAP_PAD_PX;
  const left = Math.max(-BITMAP_PAD_PX, fullLeft);
  const top = Math.max(-BITMAP_PAD_PX, fullTop);
  const right = Math.min(canvas.width + BITMAP_PAD_PX, fullRight);
  const bottom = Math.min(canvas.height + BITMAP_PAD_PX, fullBottom);
  if (!(right > left && bottom > top)) return null;
  const whole =
    left === fullLeft && top === fullTop && right === fullRight && bottom === fullBottom;
  return { left, top, width: right - left, height: bottom - top, whole };
}

function createBitmap(
  width: number,
  height: number,
): { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx === null ? null : { canvas, ctx };
}
