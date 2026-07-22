import type { RasterGroup } from './job';

export type RasterRowEntry = {
  readonly rowIndex: number;
  readonly row: Uint16Array;
};

export function rasterRow(group: RasterGroup, y: number): Uint16Array {
  if (!Number.isInteger(y) || y < 0 || y >= group.pixelHeight) {
    throw new Error(`Raster row ${y} is outside 0..${group.pixelHeight - 1}.`);
  }
  const sourceY = group.rowProviderOrder === 'descending-y' ? group.pixelHeight - 1 - y : y;
  if (group.rowProvider !== undefined) return providedRasterRow(group, sourceY);
  const start = sourceY * group.pixelWidth;
  // Consumers treat compiled Job data as immutable. A view avoids copying the
  // complete raster once per preflight/preview/estimate scan.
  return group.sValues.subarray(start, start + group.pixelWidth);
}

/**
 * Iterate raster storage in source order while carrying the physical row
 * index used for world-Y placement. This keeps materialized and streamed
 * rasters representation-independent, including descending rotary output.
 */
export function* rasterRowsInProviderOrder(group: RasterGroup): Generator<RasterRowEntry> {
  for (let sourceY = 0; sourceY < group.pixelHeight; sourceY += 1) {
    const rowIndex =
      group.rowProviderOrder === 'descending-y' ? group.pixelHeight - 1 - sourceY : sourceY;
    yield {
      rowIndex,
      row: rasterRow(group, rowIndex),
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
