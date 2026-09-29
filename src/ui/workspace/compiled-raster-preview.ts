import type { DeviceProfile } from '../../core/devices';
import type { RasterGroup } from '../../core/job';
import { rasterRow } from '../../core/job/raster-rows';
import { rasterPreviewRgba } from '../../core/raster';
import type { RasterPowerValues } from '../../core/raster/raster-power-values';

export const MAX_RASTER_PREVIEW_EDGE = 2048;

export type CompiledRasterPreview = {
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly displayDecimated: boolean;
  readonly sValues: RasterPowerValues;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
};

/**
 * Materialize a display grid from the exact compiled RasterGroup consumed by
 * output. Large groups are reduced only after every compiled row has been
 * obtained, each display pixel showing the mean power of the compiled pixels
 * it covers (ADR-028 Amendment 1), so a dithered image keeps the tone it burns.
 */
export function compiledRasterPreview(
  group: RasterGroup,
  device: DeviceProfile,
  maxEdge = MAX_RASTER_PREVIEW_EDGE,
): CompiledRasterPreview {
  const dimensions = displayDimensions(group.pixelWidth, group.pixelHeight, maxEdge);
  const sValues = materializeDisplayGrid(group, dimensions.width, dimensions.height);
  return {
    ...dimensions,
    sourceWidth: group.pixelWidth,
    sourceHeight: group.pixelHeight,
    displayDecimated:
      dimensions.width !== group.pixelWidth || dimensions.height !== group.pixelHeight,
    sValues,
    // Keep the preview on the controller/profile's absolute S scale. Using
    // this group's local maximum made every fully dark source pixel render
    // black even when the compiled operation requested only a fraction of
    // the machine's available power.
    rgba: rasterPreviewRgba(sValues, device.maxPowerS, dimensions.width, dimensions.height),
  };
}

export function displayDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = MAX_RASTER_PREVIEW_EDGE,
): { readonly width: number; readonly height: number } {
  const edge = Math.max(sourceWidth, sourceHeight);
  if (maxEdge <= 0 || edge <= maxEdge) return { width: sourceWidth, height: sourceHeight };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

// A box reduction: every compiled pixel counts once, with equal weight, toward
// the one display pixel it falls in. Keeping each block's maximum instead put a
// burned dot in almost every block of a dithered image, so a 50% grey that
// burns half its dots previewed about 86% dark.
function materializeDisplayGrid(
  group: RasterGroup,
  displayWidth: number,
  displayHeight: number,
): RasterPowerValues {
  const display = new Float64Array(displayWidth * displayHeight);
  const columnBlocks = displayBlocks(group.pixelWidth, displayWidth);
  const rowBlocks = displayBlocks(group.pixelHeight, displayHeight);
  for (let sourceY = 0; sourceY < group.pixelHeight; sourceY += 1) {
    const row = rasterRow(group, sourceY);
    const rowStart = (rowBlocks[sourceY] ?? 0) * displayWidth;
    for (let sourceX = 0; sourceX < group.pixelWidth; sourceX += 1) {
      const displayIndex = rowStart + (columnBlocks[sourceX] ?? 0);
      display[displayIndex] = (display[displayIndex] ?? 0) + (row[sourceX] ?? 0);
    }
  }
  divideByBlockSizes(
    display,
    blockSizes(columnBlocks, displayWidth),
    blockSizes(rowBlocks, displayHeight),
  );
  return display;
}

// Turn each display pixel's sum into the mean of the compiled pixels it holds.
function divideByBlockSizes(
  display: Float64Array,
  columnSizes: Uint32Array,
  rowSizes: Uint32Array,
): void {
  const displayWidth = columnSizes.length;
  for (let displayY = 0; displayY < rowSizes.length; displayY += 1) {
    for (let displayX = 0; displayX < displayWidth; displayX += 1) {
      const index = displayY * displayWidth + displayX;
      const size = (rowSizes[displayY] ?? 0) * (columnSizes[displayX] ?? 0);
      display[index] = size > 0 ? (display[index] ?? 0) / size : 0;
    }
  }
}

/** The display cell each compiled cell falls in, along one axis. */
function displayBlocks(sourceLength: number, displayLength: number): Uint32Array {
  const blocks = new Uint32Array(sourceLength);
  for (let source = 0; source < sourceLength; source += 1) {
    blocks[source] = Math.min(
      displayLength - 1,
      Math.floor((source * displayLength) / sourceLength),
    );
  }
  return blocks;
}

function blockSizes(blocks: Uint32Array, displayLength: number): Uint32Array {
  const sizes = new Uint32Array(displayLength);
  for (const block of blocks) sizes[block] = (sizes[block] ?? 0) + 1;
  return sizes;
}
