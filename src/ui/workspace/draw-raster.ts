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
const DEG_TO_RAD = Math.PI / 180;

export function drawRasterImage(
  ctx: CanvasRenderingContext2D,
  obj: { readonly dataUrl: string; readonly bounds: AABB; readonly transform: ObjTransform },
  view: ViewTransform,
): void {
  let img = rasterImageCache.get(obj.dataUrl);
  if (img === undefined) {
    img = new Image();
    img.src = obj.dataUrl;
    rasterImageCache.set(obj.dataUrl, img);
  }
  if (!img.complete || img.naturalWidth === 0) return; // still decoding
  const w = obj.bounds.maxX - obj.bounds.minX;
  const h = obj.bounds.maxY - obj.bounds.minY;
  const cx = (obj.bounds.minX + obj.bounds.maxX) / 2;
  const cy = (obj.bounds.minY + obj.bounds.maxY) / 2;
  ctx.save();
  // Translate to the object's centre (in screen space), apply the
  // transform around that centre, then drawImage relative to it.
  // Matches the polyline-rendering convention used by applyTransform.
  const t = obj.transform;
  ctx.translate(view.offsetX + (cx + t.x) * view.scale, view.offsetY + (cy + t.y) * view.scale);
  ctx.rotate(t.rotationDeg * DEG_TO_RAD);
  ctx.scale(t.mirrorX ? -t.scaleX : t.scaleX, t.mirrorY ? -t.scaleY : t.scaleY);
  ctx.drawImage(img, (-w / 2) * view.scale, (-h / 2) * view.scale, w * view.scale, h * view.scale);
  ctx.restore();
}
