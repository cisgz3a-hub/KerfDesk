// F.2.c raster-image rendering helper. Extracted from draw-scene.ts
// to stay under the 400-line file cap (CLAUDE.md ADR-015 hard cap;
// CI's raw `wc -l` includes blank/comment lines so the lint and CI
// caps differ — keep this file lean).
//
// drawImage path: HTMLImageElement is loaded lazily (async PNG
// decode) and cached per dataUrl so repeated frames hit memory.
// First paint shows nothing until the image loads — same shape as
// the SVG import flow's one-frame delay.

import type { AABB, Transform as ObjTransform } from '../../core/scene';
import type { ViewTransform } from './view-transform';

const rasterImageCache = new Map<string, HTMLImageElement>();
// Tinted copies of trace-source bitmaps, keyed by dataUrl. The tint is
// static per image, so we composite it once and reuse the canvas every
// frame rather than re-tinting on each redraw.
const tintedTraceSourceCache = new Map<string, HTMLCanvasElement>();
const DEG_TO_RAD = Math.PI / 180;

// ADR-026 trace-source tint. The source bitmap kept behind a trace is
// washed with a cool blue so the operator can see two stacked layers and
// tell which one (the tinted backing) to delete. Display only.
const TRACE_SOURCE_TINT_COLOR = '#3b82c4';
const TRACE_SOURCE_TINT_ALPHA = 0.4;

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
    readonly dataUrl: string;
    readonly bounds: AABB;
    readonly transform: ObjTransform;
    readonly role?: 'trace-source';
  },
  view: ViewTransform,
): void {
  let img = rasterImageCache.get(obj.dataUrl);
  if (img === undefined) {
    img = new Image();
    img.src = obj.dataUrl;
    rasterImageCache.set(obj.dataUrl, img);
  }
  if (!img.complete || img.naturalWidth === 0) return; // still decoding

  // Mirror core/scene/transform.ts's applyTransform exactly:
  //   p' = translate(rotate(mirror(scale(p)))) = scale → rotate-about-0,0 → translate
  // In Canvas2D, equivalent compose order is: translate, rotate, scale
  // (each new transform multiplies on the right, so the FIRST op in
  // pixel space is the LAST one we applied — i.e. scale acts first
  // on object-local points, exactly what applyTransform does).
  //
  // The previous version translated to (centre + t.x, centre + t.y)
  // and drew at (-w/2, -h/2). That worked for scaleX/Y == 1 but
  // drifted whenever fitObjectToBed scaled the import down: the
  // unscaled centre offset and the scaled bounds disagree, putting
  // the visible image off-axis from its selection-box AABB. The fix
  // is to translate to (t.x, t.y) — the object-local origin — and
  // draw at (bounds.minX, bounds.minY), so scale applies to both the
  // image dimensions and its placement, matching applyTransform.
  const t = obj.transform;
  const w = obj.bounds.maxX - obj.bounds.minX;
  const h = obj.bounds.maxY - obj.bounds.minY;
  ctx.save();
  ctx.translate(view.offsetX + t.x * view.scale, view.offsetY + t.y * view.scale);
  ctx.rotate(t.rotationDeg * DEG_TO_RAD);
  const sx = (t.mirrorX ? -1 : 1) * t.scaleX * view.scale;
  const sy = (t.mirrorY ? -1 : 1) * t.scaleY * view.scale;
  ctx.scale(sx, sy);
  // Trace-source backings draw tinted so the operator can tell the
  // deletable original apart from the trace stacked on top (ADR-026).
  const paint = obj.role === 'trace-source' ? (tintedTraceSource(obj.dataUrl, img) ?? img) : img;
  ctx.drawImage(paint, obj.bounds.minX, obj.bounds.minY, w, h);
  ctx.restore();
}
