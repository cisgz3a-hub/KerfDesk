import type { Polyline, Vec2 } from '../scene';
import type { AdaptivePocketPlan } from './adaptive-pocket';

export type AdaptivePocketVerification =
  | {
      readonly ok: true;
      readonly coverageRatio: number;
      readonly gridMm: number;
      readonly maxMeasuredLoadMm: number;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly coverageRatio?: number;
      readonly gridMm?: number;
      readonly maxMeasuredLoadMm?: number;
    };

const MAX_GRID_CELLS = 1_000_000;
const MIN_GRID_MM = 0.05;
const COVERAGE_TARGET = 0.985;
const CONTACT_BINS = 180;

type Grid = {
  readonly cellMm: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly occupied: Uint8Array;
  readonly width: number;
};

export function verifyAdaptivePocket(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  plan: AdaptivePocketPlan,
): AdaptivePocketVerification {
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const gridResult = createStockGrid(contours, toolDiameterMm, plan.optimalLoadMm);
  if (!gridResult.ok) return gridResult;
  const grid = gridResult.grid;
  const initialStock = countOccupied(grid.occupied);
  if (initialStock === 0) return { ok: false, reason: 'Adaptive verification found no stock.' };
  let maxMeasuredLoadMm = 0;
  for (const sequence of plan.sequences) {
    const entryEnd = clearEntrySweep(
      grid,
      sequence.entryCenter,
      sequence.entryRadiusMm,
      toolDiameterMm / 2,
    );
    let previous = entryEnd;
    for (const ring of sequence.rings) {
      const first = ring.points[0];
      if (first === undefined) continue;
      const connectorLoad = cutSegment(grid, previous, first, toolDiameterMm / 2);
      maxMeasuredLoadMm = Math.max(maxMeasuredLoadMm, connectorLoad);
      for (let index = 1; index < ring.points.length; index += 1) {
        const start = ring.points[index - 1];
        const end = ring.points[index];
        if (start !== undefined && end !== undefined) {
          const segmentLoad = cutSegment(grid, start, end, toolDiameterMm / 2);
          maxMeasuredLoadMm = Math.max(maxMeasuredLoadMm, segmentLoad);
        }
      }
      previous = ring.points[ring.points.length - 1] ?? first;
    }
  }
  for (const sequence of plan.sequences)
    clearFinishRings(grid, sequence.finishRings, toolDiameterMm / 2);
  return verificationResult(grid, initialStock, maxMeasuredLoadMm, plan.optimalLoadMm);
}

function verificationResult(
  grid: Grid,
  initialStock: number,
  maxMeasuredLoadMm: number,
  optimalLoadMm: number,
): AdaptivePocketVerification {
  const coverageRatio = (initialStock - countOccupied(grid.occupied)) / initialStock;
  const toleranceMm = grid.cellMm * Math.SQRT2;
  if (maxMeasuredLoadMm > optimalLoadMm + toleranceMm) {
    return {
      ok: false,
      reason: 'Adaptive verification measured radial engagement above the optimal load.',
      coverageRatio,
      gridMm: grid.cellMm,
      maxMeasuredLoadMm,
    };
  }
  if (coverageRatio < COVERAGE_TARGET) {
    return {
      ok: false,
      reason: 'Adaptive verification found reachable stock left behind.',
      coverageRatio,
      gridMm: grid.cellMm,
      maxMeasuredLoadMm,
    };
  }
  return { ok: true, coverageRatio, gridMm: grid.cellMm, maxMeasuredLoadMm };
}

type GridResult =
  | { readonly ok: true; readonly grid: Grid }
  | { readonly ok: false; readonly reason: string };

function createStockGrid(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  optimalLoadMm: number,
): GridResult {
  const bounds = contourBounds(contours);
  if (bounds === null) return { ok: false, reason: 'Adaptive verification has no pocket bounds.' };
  const cellMm = Math.max(MIN_GRID_MM, Math.min(optimalLoadMm / 2, toolDiameterMm / 16, 0.25));
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellMm));
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellMm));
  if (width * height > MAX_GRID_CELLS) {
    return {
      ok: false,
      reason: 'Adaptive verification grid is too large; split the pocket into smaller operations.',
    };
  }
  const grid: Grid = {
    cellMm,
    height,
    minX: bounds.minX,
    minY: bounds.minY,
    occupied: new Uint8Array(width * height),
    width,
  };
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (pointInContours(cellCenter(grid, col, row), contours))
        grid.occupied[row * width + col] = 1;
    }
  }
  return { ok: true, grid };
}

function clearEntrySweep(
  grid: Grid,
  center: Vec2,
  entryRadiusMm: number,
  toolRadiusMm: number,
): Vec2 {
  const circumference = 2 * Math.PI * entryRadiusMm;
  const samples = Math.max(16, Math.ceil(circumference / (grid.cellMm / 2)));
  let end = center;
  for (let index = 0; index <= samples; index += 1) {
    const angle = (index / samples) * 2 * Math.PI;
    end = {
      x: center.x + Math.cos(angle) * entryRadiusMm,
      y: center.y + Math.sin(angle) * entryRadiusMm,
    };
    clearDisk(grid, end, toolRadiusMm);
  }
  return end;
}

function cutSegment(grid: Grid, start: Vec2, end: Vec2, toolRadiusMm: number): number {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.ceil(length / (grid.cellMm / 2)));
  let maximum = 0;
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const center = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    maximum = Math.max(maximum, measuredLoad(grid, center, toolRadiusMm));
    clearDisk(grid, center, toolRadiusMm);
  }
  return maximum;
}

function clearFinishRings(grid: Grid, rings: ReadonlyArray<Polyline>, toolRadiusMm: number): void {
  for (const ring of rings) {
    for (let index = 1; index < ring.points.length; index += 1) {
      const start = ring.points[index - 1];
      const end = ring.points[index];
      if (start !== undefined && end !== undefined)
        cutSegmentWithoutMeasurement(grid, start, end, toolRadiusMm);
    }
  }
}

function cutSegmentWithoutMeasurement(
  grid: Grid,
  start: Vec2,
  end: Vec2,
  toolRadiusMm: number,
): void {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.ceil(length / (grid.cellMm / 2)));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    clearDisk(
      grid,
      { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t },
      toolRadiusMm,
    );
  }
}

function measuredLoad(grid: Grid, center: Vec2, toolRadiusMm: number): number {
  const contact = new Uint8Array(CONTACT_BINS);
  const cellHalfDiagonalMm = (grid.cellMm * Math.SQRT2) / 2;
  const radialBandMm = cellHalfDiagonalMm * 1.1;
  visitDiskCells(grid, center, toolRadiusMm, (index, distance) => {
    if (grid.occupied[index] !== 1 || distance < toolRadiusMm - radialBandMm) return;
    const point = cellCenter(grid, index % grid.width, Math.floor(index / grid.width));
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    const bin = Math.floor((((angle + Math.PI) / (2 * Math.PI)) * CONTACT_BINS) % CONTACT_BINS);
    const angularFootprint = Math.ceil(
      Math.asin(Math.min(1, cellHalfDiagonalMm / Math.max(distance, cellHalfDiagonalMm))) /
        ((2 * Math.PI) / CONTACT_BINS),
    );
    for (let offset = -angularFootprint; offset <= angularFootprint; offset += 1) {
      contact[(bin + offset + CONTACT_BINS) % CONTACT_BINS] = 1;
    }
  });
  const span = largestCircularRun(contact) * ((2 * Math.PI) / CONTACT_BINS);
  return toolRadiusMm * (1 - Math.cos(Math.min(Math.PI, span) / 2));
}

function largestCircularRun(contact: Uint8Array): number {
  let maximum = 0;
  let current = 0;
  for (let index = 0; index < contact.length * 2; index += 1) {
    if (contact[index % contact.length] === 1) {
      current = Math.min(contact.length, current + 1);
      maximum = Math.max(maximum, current);
    } else {
      current = 0;
    }
  }
  return maximum;
}

function clearDisk(grid: Grid, center: Vec2, radiusMm: number): void {
  visitDiskCells(grid, center, radiusMm, (index, distance) => {
    if (distance <= radiusMm) grid.occupied[index] = 0;
  });
}

function visitDiskCells(
  grid: Grid,
  center: Vec2,
  radiusMm: number,
  visitor: (index: number, distance: number) => void,
): void {
  const minCol = Math.max(0, Math.floor((center.x - radiusMm - grid.minX) / grid.cellMm));
  const maxCol = Math.min(
    grid.width - 1,
    Math.floor((center.x + radiusMm - grid.minX) / grid.cellMm),
  );
  const minRow = Math.max(0, Math.floor((center.y - radiusMm - grid.minY) / grid.cellMm));
  const maxRow = Math.min(
    grid.height - 1,
    Math.floor((center.y + radiusMm - grid.minY) / grid.cellMm),
  );
  const cellAllowance = (grid.cellMm * Math.SQRT2) / 2;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const point = cellCenter(grid, col, row);
      const distance = Math.hypot(point.x - center.x, point.y - center.y);
      if (distance <= radiusMm + cellAllowance) visitor(row * grid.width + col, distance);
    }
  }
}

function cellCenter(grid: Grid, col: number, row: number): Vec2 {
  return { x: grid.minX + (col + 0.5) * grid.cellMm, y: grid.minY + (row + 0.5) * grid.cellMm };
}

function contourBounds(
  contours: ReadonlyArray<Polyline>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const contour of contours) {
    for (const point of contour.points) {
      if (bounds === null) bounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
      else {
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
      }
    }
  }
  return bounds;
}

function pointInContours(point: Vec2, contours: ReadonlyArray<Polyline>): boolean {
  let inside = false;
  for (const contour of contours) if (pointInPolygon(point, contour.points)) inside = !inside;
  return inside;
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a === undefined || b === undefined || a.y > point.y === b.y > point.y) continue;
    if (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function countOccupied(cells: Uint8Array): number {
  let count = 0;
  for (const cell of cells) count += cell;
  return count;
}
