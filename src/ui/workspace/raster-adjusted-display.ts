// Canvas display of an image's ADJUSTED tone (ADR-359).
//
// Brightness, contrast and gamma rewrite the luma that burns
// (compile-job-raster -> applyLumaAdjustments), but the design canvas used to
// blit the untouched colour source. An image darkened for the burn therefore
// still showed crisp white lines on screen while the laser filled them in.
// When any adjustment is off its default, the canvas now draws the tone that
// actually burns: import's BT.601 luma of the source composited over white,
// pushed through the same adjustment curve. Unadjusted images keep their
// original colours. Display only; compile is untouched. It shows the image's
// own adjustments, not an operation's Invert brightness, which the P preview
// shows.

import { applyLumaAdjustments, type LumaAdjustments } from '../../core/raster';

const BYTE_MAX = 255;
const RGBA = 4;
// Bound the offscreen copy: a full 8192 px source would hold another
// 256 MiB of pixels just to show an adjusted tone.
const MAX_ADJUSTED_DISPLAY_EDGE = 4096;

// Held per source bitmap, then per adjustment, so duplicates of one image
// adjusted differently each keep their own copy. The outer key is the scene's
// own source string, whose hash the engine caches, so a frame never builds or
// hashes a multi-megabyte key. Copies no live object uses are pruned every
// frame (pruneAdjustedRasterDisplays), so edits never pile up canvases.
const adjustedDisplayCache = new Map<string, Map<string, HTMLCanvasElement>>();
// Past this many cached pixels (128 MiB of RGBA) a further adjusted image
// draws its untouched source instead — display only, never a refusal.
const MAX_ADJUSTED_DISPLAY_PIXELS = 32 * 1024 * 1024;
let cachedPixels = 0;

export function hasLumaAdjustments(adjustments: LumaAdjustments): boolean {
  return (
    (adjustments.brightness ?? 0) !== 0 ||
    (adjustments.contrast ?? 0) !== 0 ||
    (adjustments.gamma ?? 1) !== 1
  );
}

export function adjustmentToken(adjustments: LumaAdjustments): string {
  return `${adjustments.brightness ?? 0}:${adjustments.contrast ?? 0}:${adjustments.gamma ?? 1}`;
}

/** Grey RGBA of the burn tone: composite over white, BT.601 luma, adjust. */
export function adjustedGreyRgba(
  data: Uint8ClampedArray,
  adjustments: LumaAdjustments,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  writeAdjustedGrey(out, adjustments);
  return out;
}

// In place, so a 4096 px display needs no second full-size buffer.
function writeAdjustedGrey(data: Uint8ClampedArray, adjustments: LumaAdjustments): void {
  const curve = applyLumaAdjustments(
    Uint8Array.from({ length: BYTE_MAX + 1 }, (_, value) => value),
    adjustments,
  );
  // Transparent source burns as white. If the curve keeps white unburned, the
  // bed may keep showing through there; if it darkens white, paint it.
  const clearStaysClear = curve[BYTE_MAX] === BYTE_MAX;
  for (let i = 0; i < data.length; i += RGBA) {
    const alpha = data[i + 3] ?? BYTE_MAX;
    const luma =
      alpha === BYTE_MAX
        ? bt601(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
        : compositeLuma(data, i, alpha / BYTE_MAX);
    const tone = curve[luma] ?? BYTE_MAX;
    data[i] = tone;
    data[i + 1] = tone;
    data[i + 2] = tone;
    data[i + 3] = alpha === 0 && clearStaysClear ? 0 : BYTE_MAX;
  }
}

function bt601(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function compositeLuma(data: Uint8ClampedArray, i: number, opacity: number): number {
  return bt601(
    overWhite(data[i], opacity),
    overWhite(data[i + 1], opacity),
    overWhite(data[i + 2], opacity),
  );
}

function overWhite(value: number | undefined, opacity: number): number {
  return Math.round((value ?? 0) * opacity + BYTE_MAX * (1 - opacity));
}

/**
 * Cached adjusted copy of a decoded source bitmap, or null when no offscreen
 * 2D context is available (jsdom) so the caller falls back to the source.
 */
export function adjustedRasterDisplay(
  sourceKey: string,
  img: HTMLImageElement,
  adjustments: LumaAdjustments,
): HTMLCanvasElement | null {
  const token = adjustmentToken(adjustments);
  const copies = adjustedDisplayCache.get(sourceKey) ?? new Map<string, HTMLCanvasElement>();
  const cached = copies.get(token);
  if (cached !== undefined) return cached;
  const scale = Math.min(
    1,
    MAX_ADJUSTED_DISPLAY_EDGE / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  if (cachedPixels + width * height > MAX_ADJUSTED_DISPLAY_PIXELS) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  writeAdjustedGrey(pixels.data, adjustments);
  ctx.putImageData(pixels, 0, 0);
  copies.set(token, canvas);
  adjustedDisplayCache.set(sourceKey, copies);
  cachedPixels += width * height;
  return canvas;
}

/** Drops every adjusted copy whose (source, adjustment) no object still uses. */
export function pruneAdjustedRasterDisplays(live: ReadonlyMap<string, ReadonlySet<string>>): void {
  for (const [sourceKey, copies] of adjustedDisplayCache) {
    const liveTokens = live.get(sourceKey);
    for (const [token, canvas] of copies) {
      if (liveTokens?.has(token) === true) continue;
      copies.delete(token);
      cachedPixels -= canvas.width * canvas.height;
    }
    if (copies.size === 0) adjustedDisplayCache.delete(sourceKey);
  }
}
