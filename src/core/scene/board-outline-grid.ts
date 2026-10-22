import type { Bounds, Vec2 } from './scene-object';

export function outlineInsideGrid(
  polygon: ReadonlyArray<Vec2>,
  bounds: Bounds,
  cell: number,
  rows: number,
  columns: number,
): boolean[][] {
  const scanlines = Array.from({ length: rows + 1 }, (_, row) =>
    scanlineIntervals(polygon, bounds.minY + row * cell),
  );
  const verticesByRow = bucketVerticesByRow(polygon, bounds.minY, cell, rows);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) =>
      cellInside(
        scanlines[row] ?? [],
        scanlines[row + 1] ?? [],
        verticesByRow[row] ?? [],
        bounds.minX + column * cell,
        cell,
      ),
    ),
  );
}

function cellInside(
  top: ReadonlyArray<readonly [number, number]>,
  bottom: ReadonlyArray<readonly [number, number]>,
  rowVertices: ReadonlyArray<number>,
  x: number,
  cell: number,
): boolean {
  const spanFits = (intervals: ReadonlyArray<readonly [number, number]>): boolean =>
    intervals.some(([left, right]) => x >= left && x + cell <= right);
  return (
    spanFits(top) &&
    spanFits(bottom) &&
    !rowVertices.some((vertexX) => vertexX >= x && vertexX <= x + cell)
  );
}

function bucketVerticesByRow(
  polygon: ReadonlyArray<Vec2>,
  minY: number,
  cell: number,
  rows: number,
): ReadonlyArray<ReadonlyArray<number>> {
  const buckets = Array.from({ length: rows }, () => [] as number[]);
  for (const point of polygon) {
    const offset = (point.y - minY) / cell;
    if (Math.abs(offset - Math.round(offset)) < 1e-9) continue;
    const row = Math.floor(offset);
    if (row >= 0 && row < rows) buckets[row]?.push(point.x);
  }
  return buckets;
}

function scanlineIntervals(
  polygon: ReadonlyArray<Vec2>,
  y: number,
): ReadonlyArray<readonly [number, number]> {
  const crossings: number[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index] as Vec2;
    const b = polygon[(index + 1) % polygon.length] as Vec2;
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  crossings.sort((left, right) => left - right);
  const result: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    result.push([crossings[index] as number, crossings[index + 1] as number]);
  }
  return result;
}
