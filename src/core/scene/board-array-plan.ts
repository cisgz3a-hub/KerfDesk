// One geometric plan for both the live board preview and the applied array.
// Footprints are scene-space rectangles, including rotated artwork's AABB.
import { boardFitRegion } from './board-fit-region';
import { transformedBBox } from './hit-test';
import type { Bounds, ShapeObject } from './scene-object';
import { applyTransform } from './transform';
import {
  MAX_TILE_PER_AXIS,
  MAX_TILE_TOTAL,
  tileIntoRegion,
  type TileLayout,
  type TileOffset,
} from './tile-into-region';

export type BoardArrayPlan = {
  readonly offsets: ReadonlyArray<TileOffset>;
  readonly boardBounds: Bounds;
  readonly usableBounds: Bounds;
  readonly circular: boolean;
  readonly boardCircular: boolean;
  readonly requestedCount: number | null;
  readonly limited: boolean;
};

export function planBoardArray(
  cell: Bounds,
  board: ShapeObject,
  layout: TileLayout,
): BoardArrayPlan {
  const boardBounds = board.spec.kind === 'ellipse' ? circleBounds(board) : transformedBBox(board);
  const circular = board.spec.kind === 'ellipse' && layout.circlePacking === 'rows';
  const margin = nonNegative(layout.marginMm ?? 0);
  const boundary = arrayBoundary(board, boardBounds, circular);
  const usableBounds = {
    minX: boundary.minX + margin,
    minY: boundary.minY + margin,
    maxX: boundary.maxX - margin,
    maxY: boundary.maxY - margin,
  };
  const requestedCount = layout.kind === 'grid' ? count(layout.rows) * count(layout.cols) : null;
  const base = {
    boardBounds,
    usableBounds,
    circular,
    boardCircular: board.spec.kind === 'ellipse',
    requestedCount,
  };
  if (![...Object.values(cell), ...Object.values(usableBounds)].every(Number.isFinite)) {
    return { ...base, offsets: [], limited: false };
  }
  const width = cell.maxX - cell.minX;
  const height = cell.maxY - cell.minY;
  const regionW = usableBounds.maxX - usableBounds.minX;
  const regionH = usableBounds.maxY - usableBounds.minY;
  if (Math.min(width, height, regionW, regionH) <= 0)
    return { ...base, offsets: [], limited: false };
  const gapX = nonNegative(layout.gapXMm);
  const gapY = nonNegative(layout.gapYMm);
  const fittingCols = Math.floor((regionW + gapX) / (width + gapX));
  const fittingRows = Math.floor((regionH + gapY) / (height + gapY));
  const { cols, rows } = requestedGrid(layout, fittingCols, fittingRows);
  if (!circular) {
    const offsets = tileIntoRegion(cell, usableBounds, layout);
    return { ...base, offsets, limited: offsets.length < cols * rows };
  }

  return { ...base, ...circleRowPlan(cell, usableBounds, layout, rows) };
}

function circleRowPlan(
  cell: Bounds,
  region: Bounds,
  layout: TileLayout,
  rows: number,
): Pick<BoardArrayPlan, 'offsets' | 'limited'> {
  const width = cell.maxX - cell.minX;
  const height = cell.maxY - cell.minY;
  const gapX = nonNegative(layout.gapXMm);
  const gapY = nonNegative(layout.gapYMm);
  // Centre each row on the circle. The row's farthest vertical edge determines
  // its available chord, ensuring every rectangular footprint corner fits.
  const radius = (region.maxX - region.minX) / 2;
  const cx = (region.minX + region.maxX) / 2;
  const cy = (region.minY + region.maxY) / 2;
  const columnsAt = (y: number): number => {
    const farY = Math.max(Math.abs(y - cy), Math.abs(y + height - cy));
    const chord = 2 * Math.sqrt(Math.max(0, radius * radius - farY * farY));
    const available = Math.max(0, Math.floor((chord + gapX) / (width + gapX)));
    return layout.kind === 'grid' ? Math.min(available, count(layout.cols)) : available;
  };
  // A maximum-height row grid can miss the centre and reject a wide design
  // that fits there. Compare all bounded row counts, including both parities.
  let rowCount = 0;
  let bestCount = 0;
  for (let trial = 1; trial <= Math.min(MAX_TILE_PER_AXIS, rows); trial += 1) {
    const trialY = cy - (trial * height + (trial - 1) * gapY) / 2;
    let total = 0;
    for (let row = 0; row < trial; row += 1) {
      total += Math.min(MAX_TILE_PER_AXIS, columnsAt(trialY + row * (height + gapY)));
    }
    if (total > bestCount) {
      bestCount = total;
      rowCount = trial;
    }
  }
  const startY = cy - (rowCount * height + (rowCount - 1) * gapY) / 2;
  const candidates: TileOffset[] = [];
  let limited = rows > MAX_TILE_PER_AXIS;
  for (let row = 0; row < rowCount; row += 1) {
    const y = startY + row * (height + gapY);
    const requested = columnsAt(y);
    const colCount = Math.min(MAX_TILE_PER_AXIS, requested);
    limited ||= requested > MAX_TILE_PER_AXIS;
    const startX = cx - (colCount * width + (colCount - 1) * gapX) / 2;
    for (let col = 0; col < colCount; col += 1) {
      candidates.push({ dx: startX + col * (width + gapX) - cell.minX, dy: y - cell.minY });
    }
  }
  // Keep the central slots when the existing scene responsiveness cap applies.
  if (candidates.length > MAX_TILE_TOTAL) {
    limited = true;
    const distance = (slot: TileOffset): number =>
      (cell.minX + slot.dx + width / 2 - cx) ** 2 + (cell.minY + slot.dy + height / 2 - cy) ** 2;
    candidates.sort((a, b) => distance(a) - distance(b));
    candidates.length = MAX_TILE_TOTAL;
    candidates.sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  }
  return { offsets: candidates, limited };
}

function circleBounds(board: ShapeObject): Bounds {
  const bounds = board.bounds;
  const radius =
    Math.min(
      (bounds.maxX - bounds.minX) * Math.abs(board.transform.scaleX),
      (bounds.maxY - bounds.minY) * Math.abs(board.transform.scaleY),
    ) / 2;
  const center = applyTransform(
    { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    board.transform,
  );
  const { x: cx, y: cy } = center;
  return { minX: cx - radius, minY: cy - radius, maxX: cx + radius, maxY: cy + radius };
}

function arrayBoundary(board: ShapeObject, bounds: Bounds, circular: boolean): Bounds {
  if (board.spec.kind !== 'ellipse') return boardFitRegion(board);
  if (circular) return bounds;
  const half = (bounds.maxX - bounds.minX) / Math.SQRT2 / 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}

function requestedGrid(
  layout: TileLayout,
  cols: number,
  rows: number,
): { cols: number; rows: number } {
  return layout.kind === 'grid'
    ? { cols: Math.min(count(layout.cols), cols), rows: Math.min(count(layout.rows), rows) }
    : { cols, rows };
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
