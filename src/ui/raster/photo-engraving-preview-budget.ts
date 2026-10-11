import { effectiveOperationForObject } from '../../core/effective-output';
import { rasterScanBounds } from '../../core/job/raster-bounds';
import { sourceQuarterTurn } from '../../core/job/raster-rotated-sample';
import { imageScanPassRuns, type ScanPassRun } from '../../core/job/scan-pass-angles';
import { pixelExtentForMm } from '../../core/raster';
import { imageDitherAlgorithm } from '../../core/raster/image-processing';
import {
  evaluateRasterBudget,
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
const SOURCE_WORKING_BYTES_PER_PIXEL = 12;
const DISPLAY_WORKING_BYTES_PER_PIXEL = 16;
const MAX_PREVIEW_SCAN_RUNS = 256;

/** Cheap validation before source cloning, luma decoding or compilation. */
export function photoEngravingPreviewInputError(
  input: PhotoEngravingPreviewInput,
  requestedMaxEdge?: number,
): string | null {
  const { image } = input;
  const sourcePixels = image.pixelWidth * image.pixelHeight;
  if (!validExtent(image.pixelWidth) || !validExtent(image.pixelHeight)) {
    return 'The image has invalid pixel dimensions.';
  }
  if (image.lumaBase64 === undefined) return 'The image pixels are not ready for photo preview.';
  const sourceBudget = evaluateRasterBudget(1, 1, {
    sourcePixelCount: sourcePixels,
    sourceWorkingBytesPerPixel: SOURCE_WORKING_BYTES_PER_PIXEL,
  });
  if (sourceBudget.kind === 'too-large') return previewLimit(sourceBudget.reason);
  if (image.lumaBase64.length * 4 > MAX_RASTER_WORKING_BYTES) {
    return previewLimit('the encoded source exceeds the preview working-set budget');
  }
  const layer = effectiveOperationForObject(input.layer, image);
  if (layer.mode !== 'image') return 'Choose an Image operation to preview photo engraving.';
  if (!Number.isFinite(layer.passes) || layer.passes < 1) return 'The pass count is invalid.';
  if (!validDensity(layer)) {
    return 'The image engraving resolution is invalid.';
  }
  if (scanRunCount(layer) > MAX_PREVIEW_SCAN_RUNS) {
    return previewLimit('the scan plan contains too many different pass runs');
  }
  const runs = previewScanRuns(layer, input);
  return scanBudgetError(input, layer, runs, sourcePixels, photoPreviewMaxEdge(requestedMaxEdge));
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

function scanBudgetError(
  input: PhotoEngravingPreviewInput,
  layer: Layer,
  runs: readonly ScanPassRun[],
  sourcePixels: number,
  maxEdge: number,
): string | null {
  let workUnits = 0;
  let workingBytes = maxEdge * maxEdge * DISPLAY_WORKING_BYTES_PER_PIXEL + maskWorkingBytes(input);
  const seenAngles = new Set<number>();
  for (const run of runs) {
    const { width, height } = scanDimensions(input, layer, run.angleDeg);
    const pixelCount = width * height;
    const streamedRows = pixelCount > STREAMED_RASTER_PIXEL_THRESHOLD;
    const verdict = evaluateRasterBudget(width, height, {
      sourcePixelCount: sourcePixels,
      sourceWorkingBytesPerPixel: SOURCE_WORKING_BYTES_PER_PIXEL,
      ditherAlgorithm: imageDitherAlgorithm(layer),
      passes: run.passes,
      streamedRows,
    });
    if (verdict.kind === 'too-large') return previewLimit(verdict.reason);
    workUnits += verdict.budget.workUnits;
    if (seenAngles.has(run.angleDeg)) continue;
    seenAngles.add(run.angleDeg);
    // Account for temporary mask/orientation/diffusion buffers beyond the
    // core budget, plus every retained grid/source for multi-angle scans.
    workingBytes +=
      verdict.budget.estimatedWorkingBytes + (streamedRows ? width * 24 : pixelCount * 8);
    // A tall narrow grid fits row dithering, but preview also maps each row
    // and column to a display block. Budget both index buffers before compile.
    workingBytes += (width + height) * Uint32Array.BYTES_PER_ELEMENT;
  }
  if (workUnits > MAX_RASTER_WORK_UNITS) return previewLimit('the full scan plan is too large');
  return workingBytes > MAX_RASTER_WORKING_BYTES
    ? previewLimit('the full scan plan exceeds the preview working-set budget')
    : null;
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
  if (layer.passThrough) {
    const turn = sourceQuarterTurn(input.image, input.device, frame);
    const swapsAxes = turn === 1 || turn === 3;
    return {
      width: swapsAxes ? input.image.pixelHeight : input.image.pixelWidth,
      height: swapsAxes ? input.image.pixelWidth : input.image.pixelHeight,
    };
  }
  const bounds = rasterScanBounds(input.image, input.device, frame);
  return {
    width: pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm),
    height: pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm),
  };
}

function validExtent(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function previewLimit(reason: string): string {
  return `Photo preview is unavailable at this size: ${reason}. Output settings are unchanged.`;
}
