import type { Polyline, Vec2 } from '../scene';
import type { TraceSteps } from './trace-steps';

export type PhotoGrid = { readonly columns: number; readonly rows: number };
// The previous grid's worst case, including all white-cell splits.
const MAX_POINTS = 2 * 320 * (640 + 1);
// (1e-12)²: a ribbon edge counts as straight while its turn is numerical noise.
const STRAIGHT_SINE_SQUARED = 1e-24;

export function* photoRibbonsSteps(
  image: { readonly width: number; readonly height: number },
  grid: PhotoGrid,
  darkness: Float64Array,
  centered: boolean,
): TraceSteps<Polyline[] | null> {
  const cooperate = yield;
  const lines: Polyline[] = [];
  let points = 0;
  for (let x = 0; x < grid.columns; x += 1) {
    let y = 0;
    while (y < grid.rows) {
      if ((darkness[y * grid.columns + x] ?? 0) === 0) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < grid.rows && (darkness[y * grid.columns + x] ?? 0) > 0) y += 1;
      const line = photoRibbon(image, grid, darkness, x, start, y, centered);
      points += line.points.length;
      // Discard this bounded trial before a uniform fallback. Mixing profiles
      // by spare capacity creates visible seams between identical columns.
      if (points > MAX_POINTS) return null;
      lines.push(line);
    }
    if (cooperate) yield;
  }
  return lines;
}

export function photoRibbon(
  image: { readonly width: number; readonly height: number },
  grid: PhotoGrid,
  darkness: Float64Array,
  column: number,
  start: number,
  end: number,
  centered: boolean,
): Polyline {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const minX = (column * image.width) / grid.columns;
  const maxX = ((column + 1) * image.width) / grid.columns;
  const centerX = (minX + maxX) / 2;
  const at = (row: number): number => darkness[row * grid.columns + column] ?? 0;
  const append = (row: number, width: number): void => {
    const halfWidth = (width * (maxX - minX)) / 2;
    const y = (row * image.height) / grid.rows;
    appendStraightened(left, { x: Math.max(minX, centerX - halfWidth), y });
    appendStraightened(right, { x: Math.min(maxX, centerX + halfWidth), y });
  };
  if (centered) {
    // Cell averages belong at cell centres. Keeping endpoint half-cells
    // constant preserves the exact trapezoidal integral without the extra
    // low-pass filter caused by averaging neighbouring boundary widths.
    append(start, at(start));
    for (let row = start; row < end; row += 1) append(row + 0.5, at(row));
    append(end, at(end - 1));
  } else {
    // When the centred reconstruction exceeds the fixed point budget, use
    // this area-conserving reconstruction consistently across the entire image.
    for (let row = start; row <= end; row += 1) {
      append(row, (at(Math.max(start, row - 1)) + at(Math.min(end - 1, row))) / 2);
    }
  }
  return { points: [...left, ...right.reverse()], closed: true };
}

function appendStraightened(points: Vec2[], point: Vec2): void {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  if (a !== undefined && b !== undefined) {
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const bpX = point.x - b.x;
    const bpY = point.y - b.y;
    const cross = abX * bpY - abY * bpX;
    // Bound the turn's sine rather than the raw cross product. Equal shades
    // sampled from differently aligned cells can differ in their last bits,
    // and along a long straight edge that noise alone passes a fixed bound.
    const lengths = (abX * abX + abY * abY) * (bpX * bpX + bpY * bpY);
    if (cross * cross <= STRAIGHT_SINE_SQUARED * lengths) {
      points[points.length - 1] = point;
      return;
    }
  }
  points.push(point);
}
