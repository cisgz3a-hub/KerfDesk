import type { Polyline, Vec2 } from '../scene';
import type { AdaptivePocketPlan } from './adaptive-pocket';
import {
  createAdaptivePocketStockGrid,
  type AdaptivePocketGrid as Grid,
} from './adaptive-pocket-verification-grid';

export type AdaptivePocketVerification =
  | {
      readonly ok: true;
      readonly coverageRatio: number;
      readonly gridMm: number;
      readonly maxSimulatedEngagementMm: number;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly coverageRatio?: number;
      readonly gridMm?: number;
      readonly maxSimulatedEngagementMm?: number;
    };

const COVERAGE_TARGET = 0.985;
const CONTACT_BINS = 180;

export function verifyAdaptivePocket(
  contours: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  plan: AdaptivePocketPlan,
): AdaptivePocketVerification {
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const gridResult = createAdaptivePocketStockGrid(contours, toolDiameterMm, plan);
  if (!gridResult.ok) return gridResult;
  const grid = gridResult.grid;
  const initialStock = countOccupied(grid.occupied);
  if (initialStock === 0) return { ok: false, reason: 'Adaptive verification found no stock.' };
  let maxSimulatedEngagementMm = 0;
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
      const connectorEngagement = cutSegment(grid, previous, first, toolDiameterMm / 2);
      maxSimulatedEngagementMm = Math.max(maxSimulatedEngagementMm, connectorEngagement);
      for (let index = 1; index < ring.points.length; index += 1) {
        const start = ring.points[index - 1];
        const end = ring.points[index];
        if (start !== undefined && end !== undefined) {
          const segmentEngagement = cutSegment(grid, start, end, toolDiameterMm / 2);
          maxSimulatedEngagementMm = Math.max(maxSimulatedEngagementMm, segmentEngagement);
        }
      }
      previous = ring.points[ring.points.length - 1] ?? first;
    }
  }
  for (const sequence of plan.sequences)
    clearFinishRings(grid, sequence.finishRings, toolDiameterMm / 2);
  return verificationResult(grid, initialStock, maxSimulatedEngagementMm, plan.optimalLoadMm);
}

function verificationResult(
  grid: Grid,
  initialStock: number,
  maxSimulatedEngagementMm: number,
  engagementLimitMm: number,
): AdaptivePocketVerification {
  const coverageRatio = (initialStock - countOccupied(grid.occupied)) / initialStock;
  const toleranceMm = grid.cellMm * Math.SQRT2;
  if (maxSimulatedEngagementMm > engagementLimitMm + toleranceMm) {
    return {
      ok: false,
      reason: 'Adaptive verification simulated radial engagement above the configured limit.',
      coverageRatio,
      gridMm: grid.cellMm,
      maxSimulatedEngagementMm,
    };
  }
  if (coverageRatio < COVERAGE_TARGET) {
    return {
      ok: false,
      reason: 'Adaptive verification found reachable stock left behind.',
      coverageRatio,
      gridMm: grid.cellMm,
      maxSimulatedEngagementMm,
    };
  }
  return { ok: true, coverageRatio, gridMm: grid.cellMm, maxSimulatedEngagementMm };
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
    maximum = Math.max(maximum, simulatedRadialEngagement(grid, center, toolRadiusMm));
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

function simulatedRadialEngagement(grid: Grid, center: Vec2, toolRadiusMm: number): number {
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

function countOccupied(cells: Uint8Array): number {
  let count = 0;
  for (const cell of cells) count += cell;
  return count;
}
