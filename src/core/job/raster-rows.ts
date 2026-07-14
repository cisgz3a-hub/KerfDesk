import type { RasterGroup } from './job';

export function rasterRow(group: RasterGroup, y: number): Uint16Array {
  if (!Number.isInteger(y) || y < 0 || y >= group.pixelHeight) {
    throw new Error(`Raster row ${y} is outside 0..${group.pixelHeight - 1}.`);
  }
  if (group.rowProvider !== undefined) {
    const row = group.rowProvider(y);
    if (row.length !== group.pixelWidth) {
      throw new Error(
        `Raster row provider returned ${row.length} values; expected ${group.pixelWidth}.`,
      );
    }
    return row;
  }
  const start = y * group.pixelWidth;
  return group.sValues.slice(start, start + group.pixelWidth);
}

export function rasterValue(group: RasterGroup, x: number, y: number): number {
  if (x < 0 || x >= group.pixelWidth) return 0;
  return rasterRow(group, y)[x] ?? 0;
}
