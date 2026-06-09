import {
  applyLumaAdjustments,
  dither,
  maybeInvertLuma,
  rasterPreviewRgba,
  resampleLumaNearest,
  whiteLuma,
} from '../../core/raster';
import type { Layer, RasterImage } from '../../core/scene';

type PreviewDraft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly ditherAlgorithm: Layer['ditherAlgorithm'];
  readonly minPower: number;
  readonly negativeImage: boolean;
  readonly invertDisplay: boolean;
};

export function drawAdjustImagePreview(
  canvas: HTMLCanvasElement | null,
  image: RasterImage,
  draft: PreviewDraft,
  mode: 'source' | 'processed',
): void {
  if (canvas === null) return;
  const size = previewSize(image.pixelWidth, image.pixelHeight);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = safeContext(canvas);
  if (ctx === null) return;
  const luma = previewLuma(image, draft, mode, size);
  const rgba =
    mode === 'source' ? grayscaleRgba(luma) : processedRgba(luma, size.width, size.height, draft);
  const imageData = new Uint8ClampedArray(rgba.length);
  imageData.set(draft.invertDisplay ? invertRgba(rgba) : rgba);
  ctx.putImageData(new ImageData(imageData, size.width, size.height), 0, 0);
}

function previewLuma(
  image: RasterImage,
  draft: PreviewDraft,
  mode: 'source' | 'processed',
  size: { readonly width: number; readonly height: number },
): Uint8Array {
  const sourceLuma = decodeLuma(image.lumaBase64, image.pixelWidth * image.pixelHeight);
  const base =
    mode === 'source'
      ? sourceLuma
      : maybeInvertLuma(applyLumaAdjustments(sourceLuma, draft), draft.negativeImage);
  return resampleLumaNearest(
    { luma: base, width: image.pixelWidth, height: image.pixelHeight },
    size.width,
    size.height,
  );
}

function processedRgba(
  luma: Uint8Array,
  width: number,
  height: number,
  draft: PreviewDraft,
): Uint8ClampedArray {
  const sMax = 1000;
  const sMin = Math.round((Math.min(draft.minPower, 100) / 100) * sMax);
  const sValues = dither({ luma, width, height }, { algorithm: draft.ditherAlgorithm, sMax, sMin });
  return rasterPreviewRgba(sValues, sMax, width, height);
}

function grayscaleRgba(luma: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(luma.length * 4);
  for (let i = 0; i < luma.length; i += 1) {
    const v = luma[i] ?? 255;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function invertRgba(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - (out[i] ?? 0);
    out[i + 1] = 255 - (out[i + 1] ?? 0);
    out[i + 2] = 255 - (out[i + 2] ?? 0);
  }
  return out;
}

function decodeLuma(base64: string | undefined, expectedLength: number): Uint8Array {
  const out = whiteLuma(expectedLength);
  if (base64 === undefined) return out;
  try {
    const binary = atob(base64);
    const n = Math.min(binary.length, expectedLength);
    for (let i = 0; i < n; i += 1) out[i] = binary.charCodeAt(i);
  } catch {
    return out;
  }
  return out;
}

function safeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (typeof CanvasRenderingContext2D === 'undefined') return null;
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function previewSize(
  width: number,
  height: number,
): {
  readonly width: number;
  readonly height: number;
} {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(1, 420 / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}
