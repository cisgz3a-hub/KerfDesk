// F.2.c raster-engrave preview (ADR-028). Renders the dithered/grayscale
// burn simulation LightBurn shows in Preview mode — darker pixel = more
// power = deeper burn (LIGHTBURN-STUDY.md §1.4).
//
// WYSIWYG by reusing the compile path's own functions: core dither() →
// rasterPreviewRgba(), the same call compileJob makes (compile-job.ts
// compileRasterGroup), so the preview is byte-for-byte what gets emitted.
// This mirrors drawFillHatches, which calls core fillHatching directly
// for the fill preview.
//
// Rendered in SCENE space via drawBitmapAtTransform — it registers
// pixel-for-pixel with the on-canvas bitmap and honours rotation/mirror.
// We deliberately do NOT render from RasterGroup.bounds: those are
// machine coords with the front-left origin's Y-flip already baked in and
// no rotation, so they'd mis-register. The machine Y-flip stays confined
// to the G-code path.
//
// Only output-enabled image-mode layers render — the exact gate compileJob
// uses (layer.visible is ignored; preview shows what burns, not what's
// shown). Dither output is cached per dataUrl|algorithm|sMax since it's
// static until one of those changes.

import type { DeviceProfile } from '../../core/devices';
import { dither, rasterPreviewRgba } from '../../core/raster';
import type { Layer, Project, RasterImage } from '../../core/scene';
import { drawBitmapAtTransform } from './draw-raster';
import type { ViewTransform } from './view-transform';

const PERCENT_MAX = 100;
const previewCanvasCache = new Map<string, HTMLCanvasElement>();

export function drawRasterPreview(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  for (const layer of project.scene.layers) {
    if (!layer.output || layer.mode !== 'image') continue;
    for (const obj of project.scene.objects) {
      if (obj.kind !== 'raster-image' || obj.color !== layer.color) continue;
      drawOnePreview(ctx, obj, layer, project.device, view);
    }
  }
}

function drawOnePreview(
  ctx: CanvasRenderingContext2D,
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  view: ViewTransform,
): void {
  const canvas = previewCanvasFor(obj, layer, device);
  if (canvas === null) return;
  ctx.save();
  // Nearest-neighbour: threshold/Floyd dots must stay crisp, not blur,
  // when the small pixel grid scales up to mm bounds on the bed.
  ctx.imageSmoothingEnabled = false;
  drawBitmapAtTransform(ctx, canvas, obj.bounds, obj.transform, view);
  ctx.restore();
}

// Build (or fetch from cache) the offscreen grayscale-sim canvas for one
// image. Returns null when pixel dims are degenerate or no 2D context is
// available (e.g. jsdom under unit tests) so the caller skips it.
function previewCanvasFor(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
): HTMLCanvasElement | null {
  const { pixelWidth, pixelHeight } = obj;
  if (pixelWidth <= 0 || pixelHeight <= 0) return null;
  const sMax = powerToSMax(layer.power, device.maxPowerS);
  const key = `${obj.dataUrl}|${layer.ditherAlgorithm}|${sMax}`;
  const cached = previewCanvasCache.get(key);
  if (cached !== undefined) return cached;
  const luma = decodeLuma(obj.lumaBase64, pixelWidth * pixelHeight);
  const sValues = dither(
    { luma, width: pixelWidth, height: pixelHeight },
    { algorithm: layer.ditherAlgorithm, sMax },
  );
  const rgba = rasterPreviewRgba(sValues, sMax, pixelWidth, pixelHeight);
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const octx = canvas.getContext('2d');
  if (octx === null) return null;
  octx.putImageData(new ImageData(rgba, pixelWidth, pixelHeight), 0, 0);
  previewCanvasCache.set(key, canvas);
  return canvas;
}

// Mirror compileRasterGroup's S-scale exactly: round(clamp(power)/100 ×
// maxPowerS). Any divergence here would make the preview lie about burn
// depth.
function powerToSMax(powerPercent: number, maxPowerS: number): number {
  const clamped = Math.max(0, Math.min(PERCENT_MAX, powerPercent));
  return Math.round((clamped / PERCENT_MAX) * maxPowerS);
}

// Mirror compileJob's decodeBase64Luma: atob → charCodeAt, truncate/pad
// to the expected pixel count. Missing buffer (pre-F.2.e .lf2) degrades
// to all-zero = full-burn black, the same fallback compile uses.
function decodeLuma(base64: string | undefined, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  if (base64 === undefined) return out;
  const binary = atob(base64);
  const n = Math.min(binary.length, expectedLength);
  for (let i = 0; i < n; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
