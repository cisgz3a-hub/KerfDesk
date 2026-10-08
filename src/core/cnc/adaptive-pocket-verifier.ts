import type { Polyline, Vec2 } from '../scene';
import type { AdaptivePocketPlan } from './adaptive-pocket';
import { AdaptiveCutterContact } from './adaptive-pocket-contact';
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

// The cutter path run since the contact was last evaluated. Every move at
// least a quarter cell long is evaluated at each of its half-cell samples;
// along a run of shorter moves, such as a dense curve's fillet slivers, it is
// evaluated once the path has run a quarter cell. The contact is so evaluated
// at least every half cell of path, while every sample still clears the grid.
type ContactGauge = { runMm: number };

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
  // The grid measures coverage; the contact, and so the engagement, is exact.
  const contact = new AdaptiveCutterContact(toolDiameterMm / 2);
  let maxSimulatedEngagementMm = 0;
  for (const sequence of plan.sequences) {
    const entryEnd = clearEntrySweep(
      grid,
      sequence.entryCenter,
      sequence.entryRadiusMm,
      toolDiameterMm / 2,
    );
    contact.addEntry(sequence.entryCenter, sequence.entryRadiusMm);
    let previous = clearSeedRings(grid, contact, sequence.seedRings, entryEnd);
    const gauge: ContactGauge = { runMm: Number.POSITIVE_INFINITY };
    for (const ring of sequence.rings) {
      const first = ring.points[0];
      if (first === undefined) continue;
      const connectorEngagement = cutSegment(grid, contact, previous, first, gauge);
      maxSimulatedEngagementMm = Math.max(maxSimulatedEngagementMm, connectorEngagement);
      for (let index = 1; index < ring.points.length; index += 1) {
        const start = ring.points[index - 1];
        const end = ring.points[index];
        if (start !== undefined && end !== undefined) {
          const segmentEngagement = cutSegment(grid, contact, start, end, gauge);
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
  // One cell diagonal above the limit is allowed, as when the grid measured
  // the contact. The contact is exact now, so this is margin, not measurement
  // error; it is kept so that no verdict moves except through the measurement
  // (ADR-154 Amendment 3).
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

function cutSegment(
  grid: Grid,
  contact: AdaptiveCutterContact,
  start: Vec2,
  end: Vec2,
  gauge: ContactGauge,
): number {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.ceil(length / (grid.cellMm / 2)));
  const everySample = length >= grid.cellMm / 4;
  let maximum = 0;
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const center = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    if (index > 0) gauge.runMm += length / samples;
    // A move's first sample repeats the last one's end, and is evaluated
    // only if that end was not.
    if (gauge.runMm > 0 && (everySample || gauge.runMm >= grid.cellMm / 4)) {
      maximum = Math.max(maximum, contact.engagementMm(center, start));
      gauge.runMm = 0;
    }
    clearDisk(grid, center, contact.toolRadiusMm);
  }
  contact.addMove(start, end);
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

// Entry slotting is explicit output at plunge feed, distinct from the verified radial-clearing limit.
function clearSeedRings(
  grid: Grid,
  contact: AdaptiveCutterContact,
  rings: ReadonlyArray<Polyline> = [],
  initial: Vec2,
): Vec2 {
  let previous = initial;
  for (const ring of rings)
    for (const point of ring.points) {
      cutSegmentWithoutMeasurement(grid, previous, point, contact.toolRadiusMm);
      contact.addMove(previous, point);
      previous = point;
    }
  return previous;
}
