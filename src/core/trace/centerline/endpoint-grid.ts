import type { Vec2 } from '../../scene';

/** An ordered superset of endpoint pairs within a fixed search reach. */
export class EndpointGrid {
  private readonly cells = new Map<string, number[]>();

  private constructor(private readonly cellSize: number) {}

  static create(points: ReadonlyArray<Vec2 | undefined>, reach: number): EndpointGrid | null {
    if (!(reach > 0) || !Number.isFinite(reach)) return null;
    const grid = new EndpointGrid(Math.max(1, reach));
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      if (point === undefined || !grid.hasSafeCell(point)) return null;
      const key = grid.key(grid.cell(point.x), grid.cell(point.y));
      const bucket = grid.cells.get(key);
      if (bucket === undefined) grid.cells.set(key, [index]);
      else bucket.push(index);
    }
    return grid;
  }

  nearbyIndices(point: Vec2): number[] {
    const cx = this.cell(point.x);
    const cy = this.cell(point.y);
    const indices: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const bucket = this.cells.get(this.key(cx + dx, cy + dy));
        if (bucket !== undefined) {
          for (const index of bucket) indices.push(index);
        }
      }
    }
    // The scan's first equal-distance candidate wins. Bucket traversal must
    // therefore retain chain-array order, with each chain's start before end.
    return indices.sort((a, b) => a - b);
  }

  private hasSafeCell(point: Vec2): boolean {
    return [this.cell(point.x), this.cell(point.y)].every(
      (cell) => Number.isSafeInteger(cell) && Math.abs(cell) < Number.MAX_SAFE_INTEGER,
    );
  }

  private cell(coordinate: number): number {
    return Math.floor(coordinate / this.cellSize);
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }
}
