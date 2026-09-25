import type { Vec2 } from '../../scene';

// Coordinates beyond this are kept out of the grid and always tested.
const MAX_GRID_COORDINATE = 2 ** 40;
const CELL_KEY_STRIDE = 2 ** 26;

/**
 * A fixed point list filed by grid cell. Queries answer exactly what a scan
 * of the whole list answers, in list order; the grid only skips points that
 * cannot qualify. A non-finite point can match no finite query and is left
 * out.
 */
export class PointGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly loose: number[] = [];

  constructor(
    private readonly points: ReadonlyArray<Vec2>,
    private readonly cellSize: number,
  ) {
    points.forEach((p, index) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      if (Math.abs(p.x) >= MAX_GRID_COORDINATE || Math.abs(p.y) >= MAX_GRID_COORDINATE) {
        this.loose.push(index);
        return;
      }
      const key = this.key(this.cell(p.x), this.cell(p.y));
      const bucket = this.cells.get(key);
      if (bucket === undefined) this.cells.set(key, [index]);
      else bucket.push(index);
    });
  }

  /** The points with minX <= x <= maxX and minY <= y <= maxY, in list order. */
  inBox(minX: number, minY: number, maxX: number, maxY: number): Vec2[] {
    const inside = (p: Vec2): boolean => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    const cellsX = this.cell(maxX) - this.cell(minX) + 1;
    const cellsY = this.cell(maxY) - this.cell(minY) + 1;
    if (!(cellsX * cellsY <= this.points.length)) return this.points.filter(inside);
    const found = [...this.loose];
    for (let cx = this.cell(minX); cx <= this.cell(maxX); cx += 1) {
      for (let cy = this.cell(minY); cy <= this.cell(maxY); cy += 1) {
        for (const index of this.cells.get(this.key(cx, cy)) ?? []) found.push(index);
      }
    }
    return found
      .sort((a, b) => a - b)
      .map((index) => this.points[index] as Vec2)
      .filter(inside);
  }

  /** Whether any point lies within Euclidean `radius` of `p` (inclusive). */
  anyWithin(p: Vec2, radius: number): boolean {
    const within = (q: Vec2): boolean => Math.hypot(q.x - p.x, q.y - p.y) <= radius;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !(radius < Infinity)) {
      return this.points.some(within);
    }
    const box = 2 * Math.max(0, radius);
    return this.inBox(p.x - box, p.y - box, p.x + box, p.y + box).some(within);
  }

  /** Whether any point lies strictly within `eps` of `p` on both axes. */
  anyNear(p: Vec2, eps: number): boolean {
    const near = (q: Vec2): boolean => Math.abs(q.x - p.x) < eps && Math.abs(q.y - p.y) < eps;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    // A doubled box holds every candidate whatever the rounding of p ± eps.
    const box = 2 * eps;
    return this.inBox(p.x - box, p.y - box, p.x + box, p.y + box).some(near);
  }

  private cell(coordinate: number): number {
    return Math.floor(coordinate / this.cellSize);
  }

  private key(cx: number, cy: number): number {
    return cx * CELL_KEY_STRIDE + cy;
  }
}

// Chain assembly asks many questions of one fixed junction list; its grid is
// built once per list. A list must not change after it is first queried (a
// changed length is still caught and rebuilt).
const grids = new WeakMap<
  ReadonlyArray<Vec2>,
  { readonly grid: PointGrid; readonly length: number }
>();
const LANDMARK_CELL_PX = 8;

/** The shared grid of a fixed landmark list (junction points). */
export function landmarkGrid(points: ReadonlyArray<Vec2>): PointGrid {
  const cached = grids.get(points);
  if (cached !== undefined && cached.length === points.length) return cached.grid;
  const grid = new PointGrid(points, LANDMARK_CELL_PX);
  grids.set(points, { grid, length: points.length });
  return grid;
}
