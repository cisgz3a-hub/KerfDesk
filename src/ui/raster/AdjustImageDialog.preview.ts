import { decodeRasterLuma } from '../../core/job/raster-luma-decode';
import { dither, rasterPreviewRgba, resampleLuma } from '../../core/raster';
import { imageDitherAlgorithm, prepareImageLuma } from '../../core/raster/image-processing';
import { burnGridKernel } from '../../core/raster/luma-resample';
import type { Layer, RasterImage } from '../../core/scene';

type PreviewDraft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly ditherAlgorithm: Layer['ditherAlgorithm'];
  readonly minPower: number;
  readonly negativeImage: boolean;
  readonly passThrough: boolean;
  readonly invertDisplay: boolean;
};

export function drawAdjustImagePreview(
  canvas: HTMLCanvasElement | null,
  image: RasterImage,
  draft: PreviewDraft,
  mode: 'source' | 'processed',
  maximumPowerPercent: number,
): void {
  if (canvas === null) return;
  const size = previewSize(image.pixelWidth, image.pixelHeight);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = safeContext(canvas);
  if (ctx === null) return;
  const luma = previewLuma(image, draft, mode, size);
  const rgba =
    mode === 'source'
      ? grayscaleRgba(luma)
      : processedRgba(luma, size.width, size.height, draft, maximumPowerPercent);
  const imageData = new Uint8ClampedArray(rgba.length);
  imageData.set(draft.invertDisplay ? invertRgba(rgba) : rgba);
  ctx.putImageData(new ImageData(imageData, size.width, size.height), 0, 0);
}

// Scene objects are immutable, so an image's unadjusted preview stays valid
// for as long as the same object is on screen. Every draft edit redraws both
// panes; only the processed one depends on the draft. The decoded source comes
// from compile's own identity-keyed cache, so it is held once per object.
const sourcePreviewCache = new WeakMap<RasterImage, Uint8Array>();

function previewLuma(
  image: RasterImage,
  draft: PreviewDraft,
  mode: 'source' | 'processed',
  size: { readonly width: number; readonly height: number },
): Uint8Array {
  const sourceLuma = decodeRasterLuma(image);
  if (mode === 'source') {
    const cached = sourcePreviewCache.get(image);
    if (cached?.length === size.width * size.height) return cached;
    const preview = resampleLuma(
      { luma: sourceLuma, width: image.pixelWidth, height: image.pixelHeight },
      size.width,
      size.height,
    );
    sourcePreviewCache.set(image, preview);
    return preview;
  }
  return resampleLuma(
    {
      luma: prepareImageLuma(sourceLuma, draft, draft),
      width: image.pixelWidth,
      height: image.pixelHeight,
    },
    size.width,
    size.height,
    burnGridKernel(imageDitherAlgorithm(draft)),
  );
}

function processedRgba(
  luma: Uint8Array,
  width: number,
  height: number,
  draft: PreviewDraft,
  maximumPowerPercent: number,
): Uint8ClampedArray {
  // Min Power is an absolute machine percentage, just like the operation's
  // maximum. A fixed 100% maximum would show a different tonal range to export.
  const maximum = Math.min(100, Math.max(0, maximumPowerPercent));
  const sMax = Math.round((maximum / 100) * 1000);
  const sMin = Math.round((Math.min(maximum, Math.max(0, draft.minPower)) / 100) * 1000);
  const sValues = dither(
    { luma, width, height },
    { algorithm: imageDitherAlgorithm(draft), sMax, sMin },
  );
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
