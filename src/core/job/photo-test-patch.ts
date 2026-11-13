// ADR-711: the piece of a photo that every square of a Photo Test Card burns.
// It is cut from the photo's own stored pixels and keeps the photo's placed
// scale, so a square is a window onto the final burn, not a shrunken copy.

const BYTE_MAX = 255;
/** Source pixels kept per burn cell and axis. Finer source detail cannot reach
 * the burn grid, and every square stores its own copy of the piece. */
const SOURCE_PIXELS_PER_BURN_CELL = 2;

/** A photo's stored pixels and the size it is placed at. */
export type PhotoTestSource = {
  /** One byte a pixel, as the photo stores it: before tones and Negative. */
  readonly luma: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly widthMm: number;
  readonly heightMm: number;
};

/** The piece's place in the stored pixels; `max` is exclusive. */
export type PhotoTestWindow = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Stored pixels averaged into one patch pixel, per axis. */
  readonly stepX: number;
  readonly stepY: number;
};

export type PhotoTestPatch = {
  readonly luma: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** The piece's size at the photo's placed scale. */
  readonly widthMm: number;
  readonly heightMm: number;
};

export type PhotoTestWindowOptions = {
  /** Centre of the piece, 0..1 across and down the stored pixels. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Wanted side of the square piece; it shrinks to fit a smaller photo. */
  readonly sizeMm: number;
  /** The burn grid, which bounds how much source detail is worth keeping. */
  readonly linesPerMm: number;
};

export function photoTestWindow(
  source: Omit<PhotoTestSource, 'luma'>,
  options: PhotoTestWindowOptions,
): PhotoTestWindow {
  const x = axisWindow(source.pixelWidth, source.widthMm, options.centre.x, options);
  const y = axisWindow(source.pixelHeight, source.heightMm, options.centre.y, options);
  return {
    minX: x.min,
    maxX: x.max,
    stepX: x.step,
    minY: y.min,
    maxY: y.max,
    stepY: y.step,
  };
}

function axisWindow(
  pixels: number,
  mm: number,
  centre: number,
  options: PhotoTestWindowOptions,
): { readonly min: number; readonly max: number; readonly step: number } {
  const total = Math.max(1, Math.floor(pixels));
  const pixelsPerMm = mm > 0 ? total / mm : 0;
  const wantedStep = Math.floor(
    pixelsPerMm / (Math.max(options.linesPerMm, 1e-6) * SOURCE_PIXELS_PER_BURN_CELL),
  );
  const step = Math.max(1, Math.min(total, Number.isFinite(wantedStep) ? wantedStep : 1));
  const wanted = Math.round((Math.max(0, options.sizeMm) * pixelsPerMm) / step) * step;
  const count = Math.max(step, Math.min(Math.floor(total / step) * step, wanted));
  const fraction = Math.max(0, Math.min(1, Number.isFinite(centre) ? centre : 0.5));
  const min = Math.max(0, Math.min(total - count, Math.round(fraction * total - count / 2)));
  return { min, max: min + count, step };
}

/** The window's size at the photo's placed scale. */
export function photoTestWindowSizeMm(
  source: Omit<PhotoTestSource, 'luma'>,
  window: PhotoTestWindow,
): { readonly widthMm: number; readonly heightMm: number } {
  return {
    widthMm: ((window.maxX - window.minX) / Math.max(1, source.pixelWidth)) * source.widthMm,
    heightMm: ((window.maxY - window.minY) / Math.max(1, source.pixelHeight)) * source.heightMm,
  };
}

/**
 * Cut the window out of the photo. Blocks of `step` stored pixels are averaged
 * into one, and a mirrored photo's piece is mirrored the same way, so the
 * square burns what the placed photo burns there.
 */
export function cropPhotoTestPatch(
  source: PhotoTestSource,
  window: PhotoTestWindow,
  mirror: { readonly x: boolean; readonly y: boolean } = { x: false, y: false },
): PhotoTestPatch {
  const width = Math.max(1, Math.floor((window.maxX - window.minX) / window.stepX));
  const height = Math.max(1, Math.floor((window.maxY - window.minY) / window.stepY));
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = mirror.y ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const column = mirror.x ? width - 1 - x : x;
      luma[row * width + column] = blockMean(source, window, x, y);
    }
  }
  return { luma, pixelWidth: width, pixelHeight: height, ...photoTestWindowSizeMm(source, window) };
}

function blockMean(
  source: PhotoTestSource,
  window: PhotoTestWindow,
  blockX: number,
  blockY: number,
): number {
  let sum = 0;
  const startX = window.minX + blockX * window.stepX;
  const startY = window.minY + blockY * window.stepY;
  for (let y = startY; y < startY + window.stepY; y += 1) {
    const base = y * source.pixelWidth;
    for (let x = startX; x < startX + window.stepX; x += 1) {
      sum += source.luma[base + x] ?? BYTE_MAX;
    }
  }
  return Math.round(sum / (window.stepX * window.stepY));
}
