// Pass-Through's burn grid (ADR-359 Decision 3, ADR-492 Decision 5 and
// Amendment 1). Pass-Through burns the source pixels as they are, so its grid
// is the image's own pixel grid wherever the image's pixel rows run along the
// scan rows: upright, a half turn, or turned with the scan. A quarter turn
// swaps the grid's axes. At any other angle no burn row runs along a pixel row,
// so a grid of one cell per source pixel cannot exist. The grid then keeps the
// image's own pixel size over the box around it, so the burn keeps the image's
// density and tone. Stretching the source pixel count over that larger box
// spread the rows up to 1.41 times apart and left up to 64 % of the pixels
// unburned. Job Review says such an image is resampled (LightBurn: a
// Pass-Through image cannot be rotated). Compile, the canvas preview and both
// preview budgets size the grid here.

import type { DeviceProfile } from '../devices';
import { normalizedScanAngleDeg, type RasterScanFrame } from '../raster/raster-scan-frame';
import { originFlipsRasterX, originFlipsRasterY } from '../raster-output';
import type { RasterImage } from '../scene';
import type { RasterMachineBounds } from './raster-bounds';
import { needsRotatedSampling, sourceQuarterTurn } from './raster-rotated-sample';

export type RasterGridSize = { readonly width: number; readonly height: number };

/** Whether the image's pixel rows run along, or straight across, the scan rows. */
export function passThroughLinesUpWithScan(
  obj: RasterImage,
  device: DeviceProfile,
  frame: RasterScanFrame,
): boolean {
  return !needsRotatedSampling(obj, frame) || sourceQuarterTurn(obj, device, frame) !== null;
}

export function rasterPassThroughDimensions(
  obj: RasterImage,
  device: DeviceProfile,
  frame: RasterScanFrame,
  bounds: RasterMachineBounds,
): RasterGridSize {
  if (!passThroughLinesUpWithScan(obj, device, frame)) {
    const pitchMm = passThroughPixelPitchMm(obj);
    return {
      width: cellsAcross(bounds.maxX - bounds.minX, pitchMm),
      height: cellsAcross(bounds.maxY - bounds.minY, pitchMm),
    };
  }
  const turn = sourceQuarterTurn(obj, device, frame);
  return turn === 1 || turn === 3
    ? { width: obj.pixelHeight, height: obj.pixelWidth }
    : { width: obj.pixelWidth, height: obj.pixelHeight };
}

/**
 * The image's own pixel size in mm, the finer of its two axes, so a turned
 * grid reads every source row and column at least as densely as it is stored.
 */
export function passThroughPixelPitchMm(obj: RasterImage): number {
  const widthMm = (obj.bounds.maxX - obj.bounds.minX) * Math.abs(obj.transform.scaleX);
  const heightMm = (obj.bounds.maxY - obj.bounds.minY) * Math.abs(obj.transform.scaleY);
  return Math.min(widthMm / obj.pixelWidth, heightMm / obj.pixelHeight);
}

/**
 * The scan angle, in [0, 180), at which this image's pixel rows run along the
 * scan rows. An origin that flips one axis mirrors the scene into the machine,
 * which reverses the sense of the image's turn there (as in sourceQuarterTurn).
 */
export function scanAngleAlongImageDeg(obj: RasterImage, device: DeviceProfile): number {
  const mirrored = originFlipsRasterX(device) !== originFlipsRasterY(device);
  return normalizedScanAngleDeg(mirrored ? -obj.transform.rotationDeg : obj.transform.rotationDeg);
}

function cellsAcross(extentMm: number, pitchMm: number): number {
  const cells = Math.round(extentMm / pitchMm);
  return Number.isFinite(cells) && cells >= 1 ? cells : 1;
}
