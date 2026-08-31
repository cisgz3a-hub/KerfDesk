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
 * obtained; max-power pooling keeps small burn marks visible in the display.
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

function materializeDisplayGrid(
  group: RasterGroup,
  displayWidth: number,
  displayHeight: number,
): RasterPowerValues {
  const display = new Float64Array(displayWidth * displayHeight);
  for (let sourceY = 0; sourceY < group.pixelHeight; sourceY += 1) {
    const row = rasterRow(group, sourceY);
    const displayY = Math.min(
      displayHeight - 1,
      Math.floor((sourceY * displayHeight) / group.pixelHeight),
    );
    for (let sourceX = 0; sourceX < group.pixelWidth; sourceX += 1) {
      const displayX = Math.min(
        displayWidth - 1,
        Math.floor((sourceX * displayWidth) / group.pixelWidth),
      );
      const displayIndex = displayY * displayWidth + displayX;
      display[displayIndex] = Math.max(display[displayIndex] ?? 0, row[sourceX] ?? 0);
    }
  }
  return display;
}
