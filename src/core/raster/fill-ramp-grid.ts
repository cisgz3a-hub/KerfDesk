// Fill Ramp power grid (ADR-699), after LightBurn's Fill "Ramp Length".
//
// A ramped Fill burns as a raster whose power grows with distance from the
// shape's edges: Min power at an edge, rising linearly to full power at the
// ramp length inside it and staying full beyond. Burn depth follows power, so
// the walls of the burned area slope instead of dropping straight down. For a
// rubber stamp that slope is the shoulder that holds up the raised letters.
//
// The filled area is the even-odd scanline fill of the closed contours, the
// same rule a scanline Fill hatches with, sampled at each burn cell's centre.
// Unfilled cells reachable from outside the artwork are the OUTER side; the
// rest are holes (letters, counters, anything the fill surrounds). Edges
// facing a hole always ramp; edges facing outside ramp only with Ramp outer
// edge on, which LightBurn advises leaving off for stamps so the stamp's
// border is cut square.
//
// Distance is exact Euclidean distance from a cell centre to the nearest
// cell of the ramping side (stamp-distance.ts), so a cell beside an edge is
// half a cell from it, at any pitch.
//
// Pure-core: no clock, random or I/O.

import type { Polyline, Vec2 } from '../scene';
import { squaredFaceEdgeDistance } from './stamp-distance';

const SCANLINE_EPS = 1e-6;
const FILLED = 1;
const OUTSIDE = 2;
const HOLE = 3;

export type FillRampGridInput = {
  /** Closed contours, already in the scan frame (rows run along +X). */
  readonly contours: ReadonlyArray<Polyline>;
  /** Row pitch: the fill's line interval. */
  readonly pitchYmm: number;
  /** Cell width along the scan. */
  readonly pitchXmm: number;
  readonly rampLengthMm: number;
  readonly rampOuterEdge: boolean;
  /** S at full power and at the edge, in the caller's units. */
  readonly sMax: number;
  readonly sMin: number;
  /** Refuse (return null) above this many cells. */
  readonly maxCells: number;
};

export type FillRampGrid = {
  readonly width: number;
  readonly height: number;
  /** Scan-frame placement: cell (0, 0) spans minX..minX+pitchX, minY..minY+pitchY. */
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  readonly sValues: Float64Array;
  /** Filled cells; 0 means nothing to burn. */
  readonly filledCells: number;
};

export type FillRampGridResult =
  | { readonly kind: 'ok'; readonly grid: FillRampGrid }
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-large'; readonly cells: number };

export function fillRampGrid(input: FillRampGridInput): FillRampGridResult {
  const closed = input.contours.filter((contour) => contour.closed && contour.points.length >= 3);
  const extent = contourExtent(closed);
  if (extent === null) return { kind: 'empty' };
  // One empty cell all round, so the outside is connected around the artwork.
  const width = Math.ceil((extent.maxX - extent.minX) / input.pitchXmm) + 2;
  const height = Math.ceil((extent.maxY - extent.minY) / input.pitchYmm) + 2;
  if (width * height > input.maxCells) return { kind: 'too-large', cells: width * height };
  const minX = extent.minX - input.pitchXmm;
  const minY = extent.minY - input.pitchYmm;
  const cells = new Uint8Array(width * height);
  const filledCells = markFilledCells(closed, cells, { width, height, minX, minY, ...input });
  if (filledCells === 0) return { kind: 'empty' };
  markOutside(cells, width, height);
  const sValues = rampValues(cells, width, height, input);
  return {
    kind: 'ok',
    grid: {
      width,
      height,
      bounds: {
        minX,
        minY,
        maxX: minX + width * input.pitchXmm,
        maxY: minY + height * input.pitchYmm,
      },
      sValues,
      filledCells,
    },
  };
}

function contourExtent(contours: ReadonlyArray<Polyline>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const point of contour.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

type GridPlacement = {
  readonly width: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly pitchXmm: number;
  readonly pitchYmm: number;
};

// Even-odd membership of every cell centre, row by row.
function markFilledCells(
  contours: ReadonlyArray<Polyline>,
  cells: Uint8Array,
  grid: GridPlacement,
): number {
  let filled = 0;
  for (let row = 0; row < grid.height; row += 1) {
    const y = grid.minY + (row + 0.5) * grid.pitchYmm;
    const xs = rowCrossings(contours, y);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(((xs[i] ?? 0) - grid.minX) / grid.pitchXmm - 0.5));
      const to = Math.min(
        grid.width - 1,
        Math.floor(((xs[i + 1] ?? 0) - grid.minX) / grid.pitchXmm - 0.5),
      );
      for (let col = from; col <= to; col += 1) {
        const index = row * grid.width + col;
        if (cells[index] !== FILLED) filled += 1;
        cells[index] = FILLED;
      }
    }
  }
  return filled;
}

function rowCrossings(contours: ReadonlyArray<Polyline>, y: number): number[] {
  const xs: number[] = [];
  for (const contour of contours) {
    const points = contour.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      const crossing = edgeCrossing(a, b, y);
      if (crossing !== null) xs.push(crossing);
    }
  }
  return xs.sort((p, q) => p - q);
}

// Half-open in y, as the hatcher counts them, so a vertex on the row is
// crossed once.
function edgeCrossing(a: Vec2, b: Vec2, y: number): number | null {
  if (Math.abs(b.y - a.y) < SCANLINE_EPS) return null;
  const yLo = Math.min(a.y, b.y);
  const yHi = Math.max(a.y, b.y);
  if (y < yLo || y >= yHi) return null;
  return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
}

// Unfilled cells 4-connected to the border are OUTSIDE; the rest are holes.
function markOutside(cells: Uint8Array, width: number, height: number): void {
  const stack: number[] = [];
  const visit = (index: number): void => {
    if (cells[index] !== 0) return;
    cells[index] = OUTSIDE;
    stack.push(index);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (stack.length > 0) {
    const index = stack.pop() ?? 0;
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index + width < cells.length) visit(index + width);
  }
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] === 0) cells[index] = HOLE;
  }
}

function rampValues(
  cells: Uint8Array,
  width: number,
  height: number,
  input: FillRampGridInput,
): Float64Array {
  const ramping = new Uint8Array(cells.length);
  let anyRamping = false;
  for (let index = 0; index < cells.length; index += 1) {
    const kind = cells[index];
    if (kind === HOLE || (kind === OUTSIDE && input.rampOuterEdge)) {
      ramping[index] = 1;
      anyRamping = true;
    }
  }
  const sMax = Math.max(0, Math.round(input.sMax));
  const sMin = Math.min(sMax, Math.max(0, Math.round(input.sMin)));
  const out = new Float64Array(cells.length);
  const distance = anyRamping
    ? squaredFaceEdgeDistance(ramping, width, height, input.pitchXmm, input.pitchYmm)
    : null;
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== FILLED) continue;
    const reach = distance === null ? Infinity : Math.sqrt(distance[index] ?? Infinity);
    const share = Math.min(1, reach / input.rampLengthMm);
    out[index] = Math.round(sMin + share * (sMax - sMin));
  }
  return out;
}
