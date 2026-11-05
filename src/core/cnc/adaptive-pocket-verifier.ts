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
// The coverage target allows 1.5% of the stock in all, and once let a full-
// depth pin stand at every crossing of an island plan's cut lines (CNC audit
// v1 F2-P1-1: 8.5 mm² each, 0.858 r²). A connected patch of reachable stock
// larger than this share of r² is refused whatever share of the pocket it is.
// Plans that cover the pocket leave no reachable cell at all; the limit keeps
// a grid speck out of the verdict (ADR-154 Amendment 4).
const STRANDED_STOCK_RADIUS_SQUARED_SHARE = 0.1;

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
  const order: FinishOrder = {
    buried: new Uint8Array(grid.occupied.length),
    buriedCells: 0,
    earlyCells: 0,
  };
  let maxSimulatedEngagementMm = 0;
  // The plan's sequences are in the order the program cuts them, each one's
  // finishing rings straight after its roughing, at every depth. Within one
  // depth that is this order, so the simulation follows it.
  for (const sequence of plan.sequences) {
    const entryEnd = clearEntrySweep(
      grid,
      order,
      sequence.entryCenter,
      sequence.entryRadiusMm,
      toolDiameterMm / 2,
    );
    contact.addEntry(sequence.entryCenter, sequence.entryRadiusMm);
    let previous = clearSeedRings(grid, order, contact, sequence.seedRings, entryEnd);
    const gauge: ContactGauge = { runMm: Number.POSITIVE_INFINITY };
    for (const ring of sequence.rings) {
      const first = ring.points[0];
      if (first === undefined) continue;
      const connectorEngagement = cutSegment(grid, order, contact, previous, first, gauge);
      maxSimulatedEngagementMm = Math.max(maxSimulatedEngagementMm, connectorEngagement);
      for (let index = 1; index < ring.points.length; index += 1) {
        const start = ring.points[index - 1];
        const end = ring.points[index];
        if (start !== undefined && end !== undefined) {
          const segmentEngagement = cutSegment(grid, order, contact, start, end, gauge);
          maxSimulatedEngagementMm = Math.max(maxSimulatedEngagementMm, segmentEngagement);
        }
      }
      previous = ring.points[ring.points.length - 1] ?? first;
    }
    clearFinishRings(grid, order, sequence.finishRings, toolDiameterMm / 2);
  }
  return verificationResult(
    grid,
    initialStock,
    maxSimulatedEngagementMm,
    plan.optimalLoadMm,
    order.earlyCells,
    toolDiameterMm / 2,
  );
}

// Finishing rings run unmeasured (ADR-154 Amendment 3), so one must not run
// before the clearing beside it: its cutter would bury itself in stock and slot
// the wall at the cutting feed (CNC audit v1 F2-P2-1). A ring's centre may
// still pass through stock at a sharp corner no roughing reaches. It must not
// where a later sequence's roughing still has to clear. `buried` holds the
// cells a finishing ring's centre crossed in stock; a later roughing sweep
// over one counts it early.
type FinishOrder = { readonly buried: Uint8Array; buriedCells: number; earlyCells: number };

function verificationResult(
  grid: Grid,
  initialStock: number,
  maxSimulatedEngagementMm: number,
  engagementLimitMm: number,
  earlyFinishCells: number,
  toolRadiusMm: number,
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
  const limitCells = (STRANDED_STOCK_RADIUS_SQUARED_SHARE * toolRadiusMm ** 2) / grid.cellMm ** 2;
  if (largestStockPatchCells(grid) > limitCells) {
    return {
      ok: false,
      reason: 'Adaptive verification found a patch of reachable stock left standing.',
      coverageRatio,
      gridMm: grid.cellMm,
      maxSimulatedEngagementMm,
    };
  }
  if (earlyFinishCells > limitCells) {
    return {
      ok: false,
      reason: 'Adaptive verification found a finishing ring cut before the stock beside it.',
      coverageRatio,
      gridMm: grid.cellMm,
      maxSimulatedEngagementMm,
    };
  }
  return { ok: true, coverageRatio, gridMm: grid.cellMm, maxSimulatedEngagementMm };
}

// The largest set of stock cells that touch, edge or corner, after every pass.
function largestStockPatchCells(grid: Grid): number {
  const seen = new Uint8Array(grid.occupied.length);
  const stack: number[] = [];
  let largest = 0;
  for (let start = 0; start < grid.occupied.length; start += 1) {
    if (grid.occupied[start] === 0 || seen[start] === 1) continue;
    seen[start] = 1;
    stack.push(start);
    let cells = 0;
    while (stack.length > 0) {
      const index = stack.pop() as number;
      cells += 1;
      const row = Math.floor(index / grid.width);
      const col = index - row * grid.width;
      for (
        let nextRow = Math.max(0, row - 1);
        nextRow <= Math.min(grid.height - 1, row + 1);
        nextRow += 1
      )
        for (
          let nextCol = Math.max(0, col - 1);
          nextCol <= Math.min(grid.width - 1, col + 1);
          nextCol += 1
        ) {
          const next = nextRow * grid.width + nextCol;
          if (grid.occupied[next] === 1 && seen[next] === 0) {
            seen[next] = 1;
            stack.push(next);
          }
        }
    }
    largest = Math.max(largest, cells);
  }
  return largest;
}

function clearEntrySweep(
  grid: Grid,
  order: FinishOrder,
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
    clearDisk(grid, end, toolRadiusMm, order);
  }
  return end;
}

function cutSegment(
  grid: Grid,
  order: FinishOrder,
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
    clearDisk(grid, center, contact.toolRadiusMm, order);
  }
  contact.addMove(start, end);
  return maximum;
}

function clearFinishRings(
  grid: Grid,
  order: FinishOrder,
  rings: ReadonlyArray<Polyline>,
  toolRadiusMm: number,
): void {
  for (const ring of rings) {
    // Where the centre runs is read before the ring cuts: its own leading
    // edge clears the stock just ahead of the centre.
    forEachRingSample(grid, ring, (center) => {
      const index = cellIndex(grid, center);
      if (index === null || grid.occupied[index] === 0 || order.buried[index] === 1) return;
      order.buried[index] = 1;
      order.buriedCells += 1;
    });
    forEachRingSample(grid, ring, (center) => clearDisk(grid, center, toolRadiusMm));
  }
}

function forEachRingSample(grid: Grid, ring: Polyline, visit: (center: Vec2) => void): void {
  for (let index = 1; index < ring.points.length; index += 1) {
    const start = ring.points[index - 1];
    const end = ring.points[index];
    if (start !== undefined && end !== undefined) forEachSample(grid, start, end, visit);
  }
}

function cellIndex(grid: Grid, point: Vec2): number | null {
  const col = Math.floor((point.x - grid.minX) / grid.cellMm);
  const row = Math.floor((point.y - grid.minY) / grid.cellMm);
  return col < 0 || row < 0 || col >= grid.width || row >= grid.height
    ? null
    : row * grid.width + col;
}

function cutSegmentWithoutMeasurement(
  grid: Grid,
  order: FinishOrder,
  start: Vec2,
  end: Vec2,
  toolRadiusMm: number,
): void {
  forEachSample(grid, start, end, (center) => clearDisk(grid, center, toolRadiusMm, order));
}

function forEachSample(grid: Grid, start: Vec2, end: Vec2, visit: (center: Vec2) => void): void {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(1, Math.ceil(length / (grid.cellMm / 2)));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    visit({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  }
}

// Roughing passes `order`: a cell a finishing ring's centre crossed in stock
// that a roughing sweep still reaches was finished before it was cleared.
function clearDisk(grid: Grid, center: Vec2, radiusMm: number, order?: FinishOrder): void {
  if (order === undefined || order.buriedCells === 0) {
    visitDiskCells(grid, center, radiusMm, (index, distance) => {
      if (distance <= radiusMm) grid.occupied[index] = 0;
    });
    return;
  }
  visitDiskCells(grid, center, radiusMm, (index, distance) => {
    if (distance > radiusMm) return;
    grid.occupied[index] = 0;
    if (order.buried[index] === 1) {
      order.buried[index] = 0;
      order.buriedCells -= 1;
      order.earlyCells += 1;
    }
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
  order: FinishOrder,
  contact: AdaptiveCutterContact,
  rings: ReadonlyArray<Polyline> = [],
  initial: Vec2,
): Vec2 {
  let previous = initial;
  for (const ring of rings)
    for (const point of ring.points) {
      cutSegmentWithoutMeasurement(grid, order, previous, point, contact.toolRadiusMm);
      contact.addMove(previous, point);
      previous = point;
    }
  return previous;
}
