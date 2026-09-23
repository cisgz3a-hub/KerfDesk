// F.2.c raster-image rendering helper. Extracted from draw-scene.ts
// to stay under the 400-line file cap (CLAUDE.md ADR-015 hard cap;
// CI's raw `wc -l` includes blank/comment lines so the lint and CI
// caps differ — keep this file lean).
//
// drawImage path: HTMLImageElement is loaded lazily (async PNG
// decode) and cached per dataUrl so repeated frames hit memory.
// First paint may land before decode finishes, so callers can
// subscribe to the load event and schedule one redraw.

import { canvasTheme } from '../theme/canvas-theme';
import {
  partialCellEnd,
  partialCellStart,
  partialGridHasPartialCell,
  type PartialCellAxis,
  type PartialCellGrid,
} from '../../core/grid';
import type { LumaAdjustments } from '../../core/raster';
import type { AABB, Layer, RasterImage, Transform as ObjTransform } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import {
  adjustedRasterDisplay,
  adjustmentToken,
  hasLumaAdjustments,
  pruneAdjustedRasterDisplays,
} from './raster-adjusted-display';
import type { ViewTransform } from './view-transform';

type RasterImageCacheEntry = {
  readonly img: HTMLImageElement;
  readonly onReady: Set<() => void>;
  failed: boolean;
};

const rasterImageCache = new Map<string, RasterImageCacheEntry>();
// Tinted copies of trace-source bitmaps, keyed by dataUrl. The tint is
// static per image, so we composite it once and reuse the canvas every
// frame rather than re-tinting on each redraw.
const tintedTraceSourceCache = new Map<string, HTMLCanvasElement>();
const DEG_TO_RAD = Math.PI / 180;

// ADR-026 trace-source tint. The source bitmap kept behind a trace is
// washed with a cool blue so the operator can see two stacked layers and
// tell which one (the tinted backing) to delete. Display only.
const TRACE_SOURCE_TINT_COLOR = canvasTheme.traceSourceTint;
const TRACE_SOURCE_TINT_ALPHA = 0.4;

export function pruneRasterImageCaches(
  liveDataUrls: ReadonlySet<string>,
  liveAdjusted: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): void {
  for (const [dataUrl, entry] of rasterImageCache) {
    if (liveDataUrls.has(dataUrl)) continue;
    entry.onReady.clear();
    rasterImageCache.delete(dataUrl);
  }
  for (const dataUrl of tintedTraceSourceCache.keys()) {
    if (!liveDataUrls.has(dataUrl)) tintedTraceSourceCache.delete(dataUrl);
  }
  pruneAdjustedRasterDisplays(liveAdjusted);
}

/** Adjustments each source bitmap is still drawn with (ADR-359). */
export function liveAdjustedDisplayKeys(
  objects: ReadonlyArray<{ readonly kind: string }>,
  layerByColor: ReadonlyMap<string, Layer>,
): Map<string, Set<string>> {
  const live = new Map<string, Set<string>>();
  for (const obj of objects) {
    if (!isRasterImage(obj) || obj.role === 'trace-source') continue;
    const adjustments = burnedImageAdjustments(obj, layerByColor);
    if (!hasLumaAdjustments(adjustments)) continue;
    const sourceKey = rasterDisplayDataUrl(obj);
    const tokens = live.get(sourceKey) ?? new Set<string>();
    tokens.add(adjustmentToken(adjustments));
    live.set(sourceKey, tokens);
  }
  return live;
}

function isRasterImage(obj: { readonly kind: string }): obj is RasterImage {
  return obj.kind === 'raster-image';
}

function rasterImageEntry(dataUrl: string): RasterImageCacheEntry {
  const cached = rasterImageCache.get(dataUrl);
  if (cached !== undefined) return cached;

  const img = new Image();
  const entry: RasterImageCacheEntry = { img, onReady: new Set(), failed: false };
  img.onload = () => {
    const callbacks = [...entry.onReady];
    entry.onReady.clear();
    for (const callback of callbacks) callback();
  };
  img.onerror = () => {
    entry.failed = true;
    entry.onReady.clear();
  };
  img.src = dataUrl;
  rasterImageCache.set(dataUrl, entry);
  return entry;
}

export type DrawRasterImageOptions = {
  readonly onBitmapReady?: () => void;
  /** The adjustments that reach the burn; defaults to the object's own. */
  readonly adjustments?: LumaAdjustments;
};

// Return a copy of `img` whose opaque pixels are washed with the tint
// color; transparent regions stay clear (the 'source-atop' composite
// confines the fill to where the image already painted, so the result
// is a tinted silhouette, not a colored box). Cached per dataUrl.
// Returns null when an offscreen 2D context is unavailable (e.g. jsdom
// under unit tests) so the caller falls back to the untinted image.
function tintedTraceSource(dataUrl: string, img: HTMLImageElement): HTMLCanvasElement | null {
  const cached = tintedTraceSourceCache.get(dataUrl);
  if (cached !== undefined) return cached;
  const off = document.createElement('canvas');
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const octx = off.getContext('2d');
  if (octx === null) return null;
  octx.drawImage(img, 0, 0);
  octx.globalCompositeOperation = 'source-atop';
  octx.globalAlpha = TRACE_SOURCE_TINT_ALPHA;
  octx.fillStyle = TRACE_SOURCE_TINT_COLOR;
  octx.fillRect(0, 0, off.width, off.height);
  tintedTraceSourceCache.set(dataUrl, off);
  return off;
}

export function drawRasterImage(
  ctx: CanvasRenderingContext2D,
  obj: {
    readonly dataUrl?: string;
    readonly imageAsset?: NonNullable<RasterImage['imageAsset']>;
    readonly bounds: AABB;
    readonly transform: ObjTransform;
    readonly role?: 'trace-source';
    readonly brightness?: number;
    readonly contrast?: number;
    readonly gamma?: number;
  },
  view: ViewTransform,
  options: DrawRasterImageOptions = {},
): void {
  const displayDataUrl = rasterDisplayDataUrl(obj);
  const entry = rasterImageEntry(displayDataUrl);
  const { img } = entry;
  if (!img.complete || img.naturalWidth === 0) {
    if (!entry.failed && options.onBitmapReady !== undefined) {
      entry.onReady.add(options.onBitmapReady);
    }
    return; // still decoding
  }

  drawBitmapAtTransform(
    ctx,
    rasterPaint(obj, displayDataUrl, img, options.adjustments ?? obj),
    obj.bounds,
    obj.transform,
    view,
  );
}

// Trace-source backings draw tinted so the operator can tell the deletable
// original apart from the trace stacked on top (ADR-026). An adjusted image
// draws the grey tone that burns (ADR-359); an unadjusted one, its source.
function rasterPaint(
  obj: Parameters<typeof drawRasterImage>[1],
  displayDataUrl: string,
  img: HTMLImageElement,
  adjustments: LumaAdjustments,
): CanvasImageSource {
  if (obj.role === 'trace-source') return tintedTraceSource(displayDataUrl, img) ?? img;
  if (!hasLumaAdjustments(adjustments)) return img;
  return adjustedRasterDisplay(displayDataUrl, img, adjustments) ?? img;
}

/**
 * The image adjustments that reach the burn (ADR-359): the object's own,
 * except on a Pass-Through operation, which burns the source pixels as they
 * are. Images bind to their operation by colour.
 */
export function burnedImageAdjustments(
  obj: RasterImage,
  layerByColor: ReadonlyMap<string, Layer>,
): LumaAdjustments {
  const layer = layerByColor.get(obj.color);
  if (layer !== undefined && effectiveOperationForObject(layer, obj).passThrough) return {};
  return obj;
}

export function rasterDisplayDataUrl(obj: Pick<RasterImage, 'dataUrl' | 'imageAsset'>): string {
  if (obj.imageAsset !== undefined) return obj.imageAsset.thumbnail.dataUrl;
  if (obj.dataUrl !== undefined) return obj.dataUrl;
  throw new Error('Raster image has no display source.');
}

// Blit a decoded bitmap (an HTMLImageElement, or an offscreen canvas
// such as the tinted trace-source backing or the F.2.c dither-preview
// buffer) at an object's mm placement, mirroring core/scene/
// transform.ts's applyTransform exactly:
//   p' = translate(rotate(mirror(scale(p)))) = scale → rotate-about-0,0 → translate
// In Canvas2D the equivalent compose order is translate, rotate, scale
// (each new transform multiplies on the right, so scale acts first on
// object-local points, exactly what applyTransform does).
//
// Translating to (t.x, t.y) — the object-local origin — and drawing at
// (bounds.minX, bounds.minY) keeps the image and its selection-box AABB
// in register even when fitObjectToBed scales the import down (an
// earlier version translated to the centre and drew at -w/2,-h/2, which
// drifted under non-unit scale).
export function drawBitmapAtTransform(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  bounds: AABB,
  transform: ObjTransform,
  view: ViewTransform,
): void {
  const t = transform;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  ctx.save();
  ctx.translate(view.offsetX + t.x * view.scale, view.offsetY + t.y * view.scale);
  ctx.rotate(t.rotationDeg * DEG_TO_RAD);
  const sx = (t.mirrorX ? -1 : 1) * t.scaleX * view.scale;
  const sy = (t.mirrorY ? -1 : 1) * t.scaleY * view.scale;
  ctx.scale(sx, sy);
  ctx.drawImage(bitmap, bounds.minX, bounds.minY, w, h);
  ctx.restore();
}

type BitmapAxisSpan = {
  readonly sourceStart: number;
  readonly sourceSize: number;
  readonly gridStartMm: number;
  readonly gridEndMm: number;
};

/** Blits a grid bitmap without stretching its shorter terminal cells. */
export function drawPartialGridBitmapAtTransform(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  grid: PartialCellGrid,
  bounds: AABB,
  transform: ObjTransform,
  view: ViewTransform,
): void {
  if (grid.widthCells <= 0 || grid.heightCells <= 0) return;
  const xSpans = bitmapAxisSpans(grid, 'x');
  const ySpans = bitmapAxisSpans(grid, 'y');
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  ctx.save();
  ctx.translate(view.offsetX + transform.x * view.scale, view.offsetY + transform.y * view.scale);
  ctx.rotate(transform.rotationDeg * DEG_TO_RAD);
  ctx.scale(
    (transform.mirrorX ? -1 : 1) * transform.scaleX * view.scale,
    (transform.mirrorY ? -1 : 1) * transform.scaleY * view.scale,
  );
  for (const y of ySpans) {
    for (const x of xSpans) {
      ctx.drawImage(
        bitmap,
        x.sourceStart,
        y.sourceStart,
        x.sourceSize,
        y.sourceSize,
        bounds.minX + (x.gridStartMm / grid.widthMm) * width,
        bounds.minY + (y.gridStartMm / grid.heightMm) * height,
        ((x.gridEndMm - x.gridStartMm) / grid.widthMm) * width,
        ((y.gridEndMm - y.gridStartMm) / grid.heightMm) * height,
      );
    }
  }
  ctx.restore();
}

function bitmapAxisSpans(grid: PartialCellGrid, axis: PartialCellAxis): readonly BitmapAxisSpan[] {
  const count = axis === 'x' ? grid.widthCells : grid.heightCells;
  const extentMm = axis === 'x' ? grid.widthMm : grid.heightMm;
  if (count <= 1 || !partialGridHasPartialCell(grid, axis)) {
    return [{ sourceStart: 0, sourceSize: count, gridStartMm: 0, gridEndMm: extentMm }];
  }
  const last = count - 1;
  const terminalStartMm = partialCellStart(grid, axis, last);
  return [
    { sourceStart: 0, sourceSize: last, gridStartMm: 0, gridEndMm: terminalStartMm },
    {
      sourceStart: last,
      sourceSize: 1,
      gridStartMm: terminalStartMm,
      gridEndMm: partialCellEnd(grid, axis, last),
    },
  ];
}
