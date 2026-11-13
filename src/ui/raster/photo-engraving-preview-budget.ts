import { effectiveOperationForObject } from '../../core/effective-output';
import { rasterScanBounds } from '../../core/job/raster-bounds';
import { rasterPassThroughDimensions } from '../../core/job/raster-pass-through-grid';
import { imageScanPassRuns, type ScanPassRun } from '../../core/job/scan-pass-angles';
import { pixelExtentForMm } from '../../core/raster';
import { imageDitherAlgorithm } from '../../core/raster/image-processing';
import {
  evaluateRasterBudget,
  MAX_RASTER_SOURCE_READ_PIXELS,
  MAX_RASTER_WORKING_BYTES,
  MAX_RASTER_WORK_UNITS,
  STREAMED_RASTER_PIXEL_THRESHOLD,
} from '../../core/raster/raster-budget';
import { rasterScanFrame } from '../../core/raster/raster-scan-frame';
import type { ColoredPath, Layer, SceneObject } from '../../core/scene';
import {
  photoPreviewMaxEdge,
  type PhotoEngravingPreviewInput,
} from './photo-engraving-preview-types';

// This optional, live preview has a bounded working set. Output continues to
// use its existing streamed compiler without these preview-only limits.
//
// ADR-581 Amendment 1: the source is read once, as the burn reads it, and is
// bounded by its own pixel ceiling. The 64 MB budget covers what is built for
// the burn: the scan grids at the placed size and lines per mm, masks and the
// display. A phone photo is never charged as if every source pixel burned.
const DISPLAY_WORKING_BYTES_PER_PIXEL = 16;
// ADR-685: the material view's display sums and colour pixels.
const MATERIAL_VIEW_BYTES_PER_PIXEL = 12;
const MAX_PREVIEW_SCAN_RUNS = 256;
// Base64 is 4 characters per 3 pixels; whitespace may at most double that.
const MAX_ENCODED_CHARACTERS_PER_PIXEL = 8 / 3;
// Every scan grid streams its rows: rows are bit-identical to the materialized
// grid (ADR-243, ADR-359), so the preview still shows exactly what burns.
const STREAM_EVERY_GRID = 0;

/** What the preview may compile, or the plain-words reason it cannot. */
export type PhotoEngravingPreviewPlan =
  | { readonly kind: 'ok'; readonly streamedPixelThreshold: number }
  | {
      readonly kind: 'limit';
      readonly message: string;
      /** The source still fits one read, so Auto tones can have its histogram. */
      readonly sourceReadable: boolean;
    };

/** Cheap validation before source cloning, luma decoding or compilation. */
export function photoEngravingPreviewInputError(
  input: PhotoEngravingPreviewInput,
  requestedMaxEdge?: number,
): string | null {
  const plan = photoEngravingPreviewPlan(input, requestedMaxEdge);
  return plan.kind === 'ok' ? null : plan.message;
}

/**
 * Checked before hydrating paged pixels (ADR-581 decision 6): only the
 * dimensions are needed to know whether the source fits one read.
 */
export function photoPreviewSourceSizeError(
  pixelWidth: number,
  pixelHeight: number,
): string | null {
  if (!validExtent(pixelWidth) || !validExtent(pixelHeight)) {
    return 'The image has invalid pixel dimensions.';
  }
  const pixels = pixelWidth * pixelHeight;
  if (pixels <= MAX_RASTER_SOURCE_READ_PIXELS) return null;
  const megapixels = (pixels / 1_000_000).toFixed(0);
  const limit = (MAX_RASTER_SOURCE_READ_PIXELS / 1_000_000).toFixed(0);
  return `This photo has too many pixels to preview (${megapixels} megapixels; the preview reads up to ${limit}). Crop it in Image Studio or import a smaller copy. You can still apply the settings.`;
}

/** The preview's compile plan, checked before source cloning, decoding or compiling. */
export function photoEngravingPreviewPlan(
  input: PhotoEngravingPreviewInput,
  requestedMaxEdge?: number,
): PhotoEngravingPreviewPlan {
  const { image } = input;
  const sourceError = photoPreviewSourceSizeError(image.pixelWidth, image.pixelHeight);
  if (sourceError !== null) return unreadable(sourceError);
  if (image.lumaBase64 === undefined) {
    return unreadable('The image pixels are not ready for photo preview.');
  }
  const sourcePixels = image.pixelWidth * image.pixelHeight;
  if (image.lumaBase64.length > Math.ceil(sourcePixels * MAX_ENCODED_CHARACTERS_PER_PIXEL) + 4) {
    return unreadable('The image pixels are malformed. Open the photo in Image Studio and Apply.');
  }
  const layer = effectiveOperationForObject(input.layer, image);
  if (layer.mode !== 'image')
    return unreadable('Choose an Image operation to preview photo engraving.');
  if (!Number.isFinite(layer.passes) || layer.passes < 1)
    return unreadable('The pass count is invalid.');
  if (!validDensity(layer)) {
    return unreadable('The image engraving resolution is invalid.');
  }
  if (scanRunCount(layer) > MAX_PREVIEW_SCAN_RUNS) {
    return unreadable(previewLimit('the scan plan contains too many different pass runs'));
  }
  const maskBytes = maskWorkingBytes(input);
  if (maskBytes > MAX_RASTER_WORKING_BYTES) {
    return unreadable(previewLimit('the mask has too many points to preview'));
  }
  const runs = previewScanRuns(layer, input);
  const maxEdge = photoPreviewMaxEdge(requestedMaxEdge);
  // Photos that already fit keep their existing compile; only a plan whose
  // materialized grids would not fit streams them instead.
  for (const threshold of [STREAMED_RASTER_PIXEL_THRESHOLD, STREAM_EVERY_GRID]) {
    if (scanPlanFits(input, layer, runs, maskBytes, maxEdge, threshold)) {
      return { kind: 'ok', streamedPixelThreshold: threshold };
    }
  }
  return {
    kind: 'limit',
    message:
      'This photo is too big to preview at this size and resolution. Lower the resolution or make the photo smaller. You can still apply the settings.',
    sourceReadable: true,
  };
}

function validDensity(layer: Layer): boolean {
  return layer.passThrough || (Number.isFinite(layer.linesPerMm) && layer.linesPerMm > 0);
}

function scanRunCount(layer: Layer): number {
  // The compiler materializes this plan before replacing it for a rotary.
  // Bound that transient allocation as well as the final along-X scan.
  const changesAngle = (layer.passAngleStepDeg ?? 0) % 180 !== 0;
  return layer.imageCrossHatch === true || changesAngle
    ? Math.floor(layer.passes) * (layer.imageCrossHatch === true ? 2 : 1)
    : 1;
}

function previewScanRuns(layer: Layer, input: PhotoEngravingPreviewInput): readonly ScanPassRun[] {
  return input.device.rotary?.enabled === true
    ? [{ angleDeg: 0, passes: Math.max(1, Math.floor(layer.passes)) }]
    : imageScanPassRuns(layer);
}

function scanPlanFits(
  input: PhotoEngravingPreviewInput,
  layer: Layer,
  runs: readonly ScanPassRun[],
  maskBytes: number,
  maxEdge: number,
  streamedPixelThreshold: number,
): boolean {
  let workUnits = 0;
  const displayBytesPerPixel =
    DISPLAY_WORKING_BYTES_PER_PIXEL +
    (input.materialView === true ? MATERIAL_VIEW_BYTES_PER_PIXEL : 0);
  let workingBytes = maxEdge * maxEdge * displayBytesPerPixel + maskBytes;
  const seenAngles = new Set<number>();
  for (const run of runs) {
    // Runs at one angle share one compiled grid (ADR-492), and the preview
    // shows that grid once, whatever the pass count (ADR-581 decision 5), so
    // each angle costs one pass. Charging every pass refused multi-pass photos
    // as "too big" though the preview's work was flat (T15-P2-2).
    if (seenAngles.has(run.angleDeg)) continue;
    seenAngles.add(run.angleDeg);
    const { width, height } = scanDimensions(input, layer, run.angleDeg);
    const pixelCount = width * height;
    const streamedRows = pixelCount > streamedPixelThreshold;
    const verdict = evaluateRasterBudget(width, height, {
      ditherAlgorithm: imageDitherAlgorithm(layer),
      passes: 1,
      streamedRows,
    });
    if (verdict.kind === 'too-large') return false;
    workUnits += verdict.budget.workUnits;
    // Account for temporary mask/orientation/diffusion buffers beyond the
    // core budget, plus every retained grid for multi-angle scans.
    workingBytes +=
      verdict.budget.estimatedWorkingBytes + (streamedRows ? width * 24 : pixelCount * 8);
    // A tall narrow grid fits row dithering, but preview also maps each row
    // and column to a display block. Budget both index buffers before compile.
    workingBytes += (width + height) * Uint32Array.BYTES_PER_ELEMENT;
  }
  return workUnits <= MAX_RASTER_WORK_UNITS && workingBytes <= MAX_RASTER_WORKING_BYTES;
}

function unreadable(message: string): PhotoEngravingPreviewPlan {
  return { kind: 'limit', message, sourceReadable: false };
}

function maskWorkingBytes(input: PhotoEngravingPreviewInput): number {
  const mask = input.sceneObjects.find((object) => object.id === input.image.imageMaskId);
  const paths = [input.image.imageClip ?? [], maskPaths(mask)];
  let bytes = 0;
  for (const group of paths) {
    for (const path of group) {
      bytes += 256;
      for (const line of path.polylines) bytes += 128 + line.points.length * 192;
      for (const curve of path.curves ?? []) bytes += 128 + curve.segments.length * 512;
      if (bytes > MAX_RASTER_WORKING_BYTES) return bytes;
    }
  }
  return bytes;
}

function maskPaths(mask: SceneObject | undefined): readonly ColoredPath[] {
  if (mask === undefined) return [];
  return mask.kind === 'imported-svg' ||
    mask.kind === 'traced-image' ||
    mask.kind === 'text' ||
    mask.kind === 'shape'
    ? mask.paths
    : [];
}

function scanDimensions(
  input: PhotoEngravingPreviewInput,
  layer: Layer,
  angleDeg: number,
): { readonly width: number; readonly height: number } {
  const frame = rasterScanFrame(angleDeg);
  const bounds = rasterScanBounds(input.image, input.device, frame);
  if (layer.passThrough) {
    return rasterPassThroughDimensions(input.image, input.device, frame, bounds);
  }
  return {
    width: pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm),
    height: pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm),
  };
}

function validExtent(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function previewLimit(reason: string): string {
  return `Photo preview is unavailable: ${reason}. You can still apply the settings.`;
}
