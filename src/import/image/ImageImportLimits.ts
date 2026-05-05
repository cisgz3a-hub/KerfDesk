/**
 * T2-124: pre-decode size + pixel limits for image imports
 * (decompression bomb protection). Pre-T2-124 the import flow
 * read the file fully and decoded fully before any pixel-count
 * check ran — a 50000×50000 PNG of one colour compresses to ~1MB
 * but decodes to 10GB, crashing the renderer or freezing the UI.
 *
 * Audit 5D Critical 8 + Required Priority 8. T2-124 ships the
 * limits + check helpers + a typed error; wiring them into
 * `useImport.ts` so the order of operations becomes file-size
 * check → header probe → pixel-cap check → full decode is filed
 * as T2-124-followup so the change to the import flow lands as
 * a coupled diff with its own UI tests.
 */

export const IMAGE_LIMITS = {
  /** Maximum file bytes — catches the easy "5GB BMP" case. */
  MAX_FILE_BYTES: 50 * 1024 * 1024,
  /** Maximum decoded pixels — ~7100×7100. The key bomb-protection cap. */
  MAX_PIXELS: 50_000_000,
  /** Maximum width OR height alone, even when the area fits. */
  MAX_DIMENSION: 16_384,
} as const;

export type ImageLimitKey = keyof typeof IMAGE_LIMITS;

/**
 * Specific error thrown by the import path when a limit trips.
 * Carries the limit name + observed value + maximum so the UI can
 * render an informative message ("Image too large: 50000×50000 = 2500M
 * pixels. Maximum: 50 megapixels.").
 */
export class ImageImportLimitError extends Error {
  override readonly name = 'ImageImportLimitError';
  readonly limit: ImageLimitKey;
  readonly observed: number;
  readonly maximum: number;
  /** When the failure was on dimensions, capture both. */
  readonly width?: number;
  readonly height?: number;

  constructor(
    limit: ImageLimitKey,
    observed: number,
    extras?: { width?: number; height?: number },
  ) {
    super(`Image ${limit} exceeded: observed ${observed}, limit ${IMAGE_LIMITS[limit]}`);
    this.limit = limit;
    this.observed = observed;
    this.maximum = IMAGE_LIMITS[limit];
    this.width = extras?.width;
    this.height = extras?.height;
    Object.setPrototypeOf(this, ImageImportLimitError.prototype);
  }
}

/**
 * Stage 1: file-size check. Throws when bytes > MAX_FILE_BYTES.
 * Run BEFORE reading the file — for File objects, `.size` is free.
 */
export function checkImageFileSize(bytes: number): void {
  if (bytes > IMAGE_LIMITS.MAX_FILE_BYTES) {
    throw new ImageImportLimitError('MAX_FILE_BYTES', bytes);
  }
}

/**
 * Stage 2: post-header pixel-count check. Throws when:
 * - either dimension exceeds MAX_DIMENSION, OR
 * - the total pixel count exceeds MAX_PIXELS.
 *
 * Run AFTER getting `width × height` from a header probe (PNG IHDR,
 * JPEG SOF, or `createImageBitmap` followed by close()), and BEFORE
 * the full decode used for rendering.
 */
export function checkImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)
      || width < 0 || height < 0) {
    throw new ImageImportLimitError('MAX_DIMENSION', Math.max(width, height) || 0,
      { width, height });
  }
  if (width > IMAGE_LIMITS.MAX_DIMENSION) {
    throw new ImageImportLimitError('MAX_DIMENSION', width, { width, height });
  }
  if (height > IMAGE_LIMITS.MAX_DIMENSION) {
    throw new ImageImportLimitError('MAX_DIMENSION', height, { width, height });
  }
  const totalPixels = width * height;
  if (totalPixels > IMAGE_LIMITS.MAX_PIXELS) {
    throw new ImageImportLimitError('MAX_PIXELS', totalPixels, { width, height });
  }
}

/**
 * User-facing message for an `ImageImportLimitError`. Mirrors the
 * audit's wording — "Image too large: WIDTH×HEIGHT = N megapixels.
 * Maximum: M megapixels." Returns a fallback for unknown errors.
 */
export function imageLimitErrorMessage(err: unknown): string {
  if (!(err instanceof ImageImportLimitError)) {
    return 'Cannot import image: an unexpected error occurred while reading the file.';
  }
  switch (err.limit) {
    case 'MAX_FILE_BYTES': {
      const mb = (err.observed / 1024 / 1024).toFixed(1);
      const maxMb = (err.maximum / 1024 / 1024).toFixed(0);
      return `Image file too large: ${mb} MB. The maximum supported is ${maxMb} MB.`;
    }
    case 'MAX_PIXELS': {
      const observedMp = (err.observed / 1_000_000).toFixed(1);
      const maxMp = (err.maximum / 1_000_000).toFixed(0);
      const dims = err.width != null && err.height != null
        ? `${err.width}×${err.height} = `
        : '';
      return `Image too large: ${dims}${observedMp}M pixels. The maximum supported is ${maxMp} megapixels.`;
    }
    case 'MAX_DIMENSION': {
      const dims = err.width != null && err.height != null
        ? ` (${err.width}×${err.height})`
        : '';
      return `Image dimension too large${dims}: a side of ${err.observed.toLocaleString()} pixels exceeds the maximum of ${err.maximum.toLocaleString()}.`;
    }
  }
}

/**
 * Convenience for the import path: run the full pre-decode check
 * pipeline. Throws the first ImageImportLimitError that fires, or
 * returns the dimensions back to the caller for the post-decode step.
 */
export function checkImageBeforeDecode(args: {
  fileBytes: number;
  width: number;
  height: number;
}): { width: number; height: number; pixels: number } {
  checkImageFileSize(args.fileBytes);
  checkImageDimensions(args.width, args.height);
  return {
    width: args.width,
    height: args.height,
    pixels: args.width * args.height,
  };
}
