// Raster rows under a rotary taper warp (ADR-694). A rotary scans images along
// X (compile-job-raster.ts), and each row is one angle round the part. On a
// cone the warp moves a design row by a different amount at every X, so the
// warped image is resampled: output row k at warped Y y' takes, in column i,
// the source pixel whose design Y warps onto y' at that column's X. Rows keep
// their pitch in warped units, so the warped image has as many more rows as
// its Y extent grew. Pixels that come from outside the source image are 0, off.
//
// Streamed sources (ADR-243) are read forward only: the source rows one output
// row needs move monotonically with k, so a small window of copied rows serves
// every column and each source row is asked for once.

import type { RasterPowerValues } from '../raster/raster-power-values';
import type { RasterGroup } from './job';
import { rasterRow } from './raster-rows';
import {
  rotaryTaperYFactorAt,
  warpRotaryTaperBounds,
  type RotaryTaperProfile,
} from './rotary-taper-profile';

type RowSampler = (outputRow: number) => Float64Array;

export function warpRasterGroup(group: RasterGroup, profile: RotaryTaperProfile): RasterGroup {
  const width = group.pixelWidth;
  const height = group.pixelHeight;
  if (width <= 0 || height <= 0) return group;
  const pitch = (group.bounds.maxY - group.bounds.minY) / height;
  if (!(pitch > 0)) return group;
  const warped = warpRotaryTaperBounds(profile, group.bounds);
  const outputHeight = Math.max(1, Math.ceil((warped.maxY - warped.minY) / pitch - 1e-9));
  const bounds = { ...warped, maxY: warped.minY + outputHeight * pitch };
  const sample = rowSampler(group, profile, bounds.minY, pitch);
  const descending = group.rowProviderOrder === 'descending-y';
  // Always a provider, built lazily: Frame, bounds and the estimate read only
  // the bounds, and the emitter reads rows once, in order.
  return {
    ...group,
    pixelHeight: outputHeight,
    bounds,
    sValues: new Float64Array(0),
    rowProvider: (providerRow) => sample(descending ? outputHeight - 1 - providerRow : providerRow),
  };
}

function rowSampler(
  group: RasterGroup,
  profile: RotaryTaperProfile,
  outputMinY: number,
  pitch: number,
): RowSampler {
  const width = group.pixelWidth;
  const height = group.pixelHeight;
  const columnWidth = (group.bounds.maxX - group.bounds.minX) / width;
  const inverseFactors = Float64Array.from({ length: width }, (_, column) => {
    const x = group.bounds.minX + (column + 0.5) * columnWidth;
    return 1 / rotaryTaperYFactorAt(profile, x);
  });
  const window = new Map<number, RasterPowerValues>();
  const sourceRowAt = (row: number): RasterPowerValues => {
    const held = window.get(row);
    if (held !== undefined) return held;
    // A provider may reuse its buffer; keep a copy for the other columns.
    const copy = Float64Array.from(rasterRow(group, row));
    window.set(row, copy);
    return copy;
  };
  return (outputRow) => {
    const y = outputMinY + (outputRow + 0.5) * pitch;
    const out = new Float64Array(width);
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let column = 0; column < width; column += 1) {
      const sourceY = profile.baseY + (y - profile.baseY) * (inverseFactors[column] ?? 1);
      const row = Math.floor((sourceY - group.bounds.minY) / pitch);
      if (row < 0 || row >= height) continue;
      low = Math.min(low, row);
      high = Math.max(high, row);
      out[column] = sourceRowAt(row)[column] ?? 0;
    }
    for (const row of window.keys()) {
      if (row < low || row > high) window.delete(row);
    }
    return out;
  };
}
