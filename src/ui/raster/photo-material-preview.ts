import type { DeviceProfile } from '../../core/devices';
import type { RasterGroup } from '../../core/job';
import { rasterRow } from '../../core/job/raster-rows';
import { rasterPreviewRgba } from '../../core/raster';
import { beamSpreadKernel, spreadRasterRows } from '../../core/raster/beam-spread';
import type { PhotoMaterialSpread } from './photo-engraving-preview-types';

/** Bound the spread pass: cells x kernel sub-cells (ADR-685). */
const MAX_SPREAD_WORK = 120_000_000;
const SUBDIVISION_CHOICES = [3, 2, 1] as const;

/**
 * ADR-685: the compiled marks as the laser spot spreads them, reduced to the
 * same display grid as the dot preview. The spot is drawn round, its diameter
 * the geometric mean of the profile's X and Y spot sizes, because angled scans
 * turn the spot against the grid.
 */
export function photoMaterialPreview(
  group: RasterGroup,
  device: DeviceProfile,
  fullMarkS: number,
  display: { readonly width: number; readonly height: number },
): { readonly rgba: Uint8ClampedArray<ArrayBuffer>; readonly spread: PhotoMaterialSpread } {
  const spot = device.laserSubProfile?.spotSizeMm;
  const cellMm = Math.sqrt(
    ((group.bounds.maxX - group.bounds.minX) / group.pixelWidth) *
      ((group.bounds.maxY - group.bounds.minY) / group.pixelHeight),
  );
  const spotMm = spot === undefined ? 0 : Math.sqrt(spot.x * spot.y);
  if (!(spotMm > 0) || !(cellMm > 0)) {
    return { rgba: displayRgba(group, display, fullMarkS, null), spread: { kind: 'unknown-spot' } };
  }
  const diameter = spotMm / cellMm;
  const cells = group.pixelWidth * group.pixelHeight;
  const subdivisions =
    SUBDIVISION_CHOICES.find((s) => cells * (diameter * s + 2) ** 2 <= MAX_SPREAD_WORK) ?? 1;
  return {
    rgba: displayRgba(group, display, fullMarkS, { diameter, subdivisions }),
    spread: { kind: 'spot', spotMm, cellMm, subdivisions },
  };
}

function displayRgba(
  group: RasterGroup,
  display: { readonly width: number; readonly height: number },
  fullMarkS: number,
  spread: { readonly diameter: number; readonly subdivisions: number } | null,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height } = display;
  const sums = new Float64Array(width * height);
  const columns = blocks(group.pixelWidth, width);
  const rows = blocks(group.pixelHeight, height);
  const add = (y: number, row: ArrayLike<number>): void => {
    const start = (rows[y] ?? 0) * width;
    for (let x = 0; x < group.pixelWidth; x += 1) {
      const index = start + (columns[x] ?? 0);
      sums[index] = (sums[index] ?? 0) + Math.min(fullMarkS, row[x] ?? 0);
    }
  };
  const kernel =
    spread === null
      ? null
      : beamSpreadKernel(spread.diameter, spread.diameter, spread.subdivisions);
  if (kernel === null) {
    for (let y = 0; y < group.pixelHeight; y += 1) add(y, rasterRow(group, y));
  } else {
    spreadRasterRows(
      group.pixelWidth,
      group.pixelHeight,
      fullMarkS,
      kernel,
      (y) => rasterRow(group, y),
      add,
    );
  }
  const columnSizes = sizes(columns, width);
  const rowSizes = sizes(rows, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const size = (rowSizes[y] ?? 0) * (columnSizes[x] ?? 0);
      const index = y * width + x;
      sums[index] = size > 0 ? (sums[index] ?? 0) / size : 0;
    }
  }
  return rasterPreviewRgba(sums, fullMarkS, width, height);
}

// The same block mapping as compiledRasterPreview, so both views line up.
function blocks(sourceLength: number, displayLength: number): Uint32Array {
  const out = new Uint32Array(sourceLength);
  for (let source = 0; source < sourceLength; source += 1) {
    out[source] = Math.min(displayLength - 1, Math.floor((source * displayLength) / sourceLength));
  }
  return out;
}

function sizes(blockIndex: Uint32Array, displayLength: number): Uint32Array {
  const out = new Uint32Array(displayLength);
  for (const block of blockIndex) out[block] = (out[block] ?? 0) + 1;
  return out;
}
