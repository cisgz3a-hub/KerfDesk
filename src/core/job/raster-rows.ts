import type { RasterGroup } from './job';

export type RasterRowEntry = {
  readonly rowIndex: number;
  readonly row: Uint16Array;
};

export function rasterRow(group: RasterGroup, y: number): Uint16Array {
  if (!Number.isInteger(y) || y < 0 || y >= group.pixelHeight) {
    throw new Error(`Raster row ${y} is outside 0..${group.pixelHeight - 1}.`);
  }
  if (group.rowProvider !== undefined) {
    const providerY = group.rowProviderOrder === 'descending-y' ? group.pixelHeight - 1 - y : y;
    return providedRasterRow(group, providerY);
  }
  const start = y * group.pixelWidth;
  // Consumers treat compiled Job data as immutable. A view avoids copying the
  // complete raster once per preflight/preview/estimate scan.
  return group.sValues.subarray(start, start + group.pixelWidth);
}

/**
 * Iterate a streamed provider in its required forward order while carrying
 * the physical row index used for world-Y placement. Materialized rasters
 * retain their conventional ascending physical order.
 */
export function* rasterRowsInProviderOrder(group: RasterGroup): Generator<RasterRowEntry> {
  if (group.rowProvider === undefined) {
    for (let rowIndex = 0; rowIndex < group.pixelHeight; rowIndex += 1) {
      yield { rowIndex, row: rasterRow(group, rowIndex) };
    }
    return;
  }
  for (let providerY = 0; providerY < group.pixelHeight; providerY += 1) {
    yield {
      rowIndex:
        group.rowProviderOrder === 'descending-y' ? group.pixelHeight - 1 - providerY : providerY,
      row: providedRasterRow(group, providerY),
    };
  }
}

function providedRasterRow(group: RasterGroup, providerY: number): Uint16Array {
  const row = group.rowProvider?.(providerY);
  if (row === undefined || row.length !== group.pixelWidth) {
    throw new Error(
      `Raster row provider returned ${row?.length ?? 0} values; expected ${group.pixelWidth}.`,
    );
  }
  return row;
}

export function rasterValue(group: RasterGroup, x: number, y: number): number {
  if (x < 0 || x >= group.pixelWidth) return 0;
  return rasterRow(group, y)[x] ?? 0;
}
