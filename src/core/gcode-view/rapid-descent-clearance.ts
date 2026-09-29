// Rapid descents into air the program has already cut (second CNC audit
// P2-preview-1). A deeper pass over a path the job has already cut rapids down
// inside its own slot to just above the earlier floor (ADR-489, ADR-520), for
// example `G0 Z-2.000` then `G1 Z-6.000`. That G0 ends below Z0 but in air.
// The program text alone tells it apart from a rapid into stock: an earlier
// feed move went through the same XY at or below the Z the rapid stops at.
// The Inspector knows no cutter, so "the same XY" is the descent's own point
// within DESCENT_XY_TOLERANCE_MM, never a cutter footprint.

import { SEG_KIND, SEG_MOTION, type GcodeRenderModel } from './render-model-types';

/** Emitted coordinates carry 3 decimals; stored positions are float32. */
const DESCENT_XY_TOLERANCE_MM = 0.01;
const Z_TOLERANCE_MM = 0.001;
/** Lookup cell size. Only speed depends on it; every match is exact. */
const CELL_MM = 5;
/** A segment whose padded box spans more cells than this is walked instead. */
const BOX_CELL_LIMIT = 9;
const CELL_OFFSET = 2 ** 20;
const CELL_STRIDE = 2 ** 21;

type Descent = {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  deepestFedZ: number;
};

type DescentGrid = ReadonlyMap<number, ReadonlyArray<Descent>>;

/** Segment indices of the Z-only rapids that end below `belowZ` in air an
 *  earlier feed move already cut to at least that depth at their XY. */
export function rapidDescentsIntoCutAir(
  model: GcodeRenderModel,
  belowZ: number,
): ReadonlySet<number> {
  const descents = rapidDescentsBelow(model, belowZ);
  const last = descents[descents.length - 1];
  if (last === undefined) return new Set();
  const grid = descentGrid(descents);
  // Only feed moves before a descent can have cut its air.
  for (let index = 0; index < last.index; index += 1) {
    if (model.segMotion[index] !== SEG_MOTION.rapid) recordFeedMove(model, index, grid);
  }
  const intoAir = descents.filter((descent) => descent.deepestFedZ <= descent.z + Z_TOLERANCE_MM);
  return new Set(intoAir.map((descent) => descent.index));
}

function rapidDescentsBelow(model: GcodeRenderModel, belowZ: number): Descent[] {
  const descents: Descent[] = [];
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segMotion[index] !== SEG_MOTION.rapid) continue;
    if (model.segKind[index] !== SEG_KIND.plunge) continue;
    const base = index * 6;
    const z = model.positions[base + 5] ?? 0;
    if (!(z < belowZ)) continue;
    const x = model.positions[base + 3] ?? 0;
    const y = model.positions[base + 4] ?? 0;
    descents.push({ index, x, y, z, deepestFedZ: Number.POSITIVE_INFINITY });
  }
  return descents;
}

function descentGrid(descents: ReadonlyArray<Descent>): DescentGrid {
  const grid = new Map<number, Descent[]>();
  for (const descent of descents) {
    const key = cellKey(cellOf(descent.x), cellOf(descent.y));
    const bucket = grid.get(key);
    if (bucket === undefined) grid.set(key, [descent]);
    else bucket.push(descent);
  }
  return grid;
}

// Lowers each later descent's deepest fed Z where this feed move passes
// within the tolerance of its point, at the move's Z there.
function recordFeedMove(model: GcodeRenderModel, index: number, grid: DescentGrid): void {
  const move = segmentAt(model, index);
  const visit = (descent: Descent): void => {
    if (descent.index <= index) return;
    const zAt = zNearPoint(move, descent.x, descent.y);
    if (zAt !== null && zAt < descent.deepestFedZ) descent.deepestFedZ = zAt;
  };
  const pad = DESCENT_XY_TOLERANCE_MM;
  const minX = cellOf(Math.min(move.x0, move.x1) - pad);
  const maxX = cellOf(Math.max(move.x0, move.x1) + pad);
  const minY = cellOf(Math.min(move.y0, move.y1) - pad);
  const maxY = cellOf(Math.max(move.y0, move.y1) + pad);
  if ((maxX - minX + 1) * (maxY - minY + 1) <= BOX_CELL_LIMIT) {
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) grid.get(cellKey(cx, cy))?.forEach(visit);
    }
    return;
  }
  walkCells(move, (cx, cy) => grid.get(cellKey(cx, cy))?.forEach(visit));
}

// Samples at most one cell apart put every point of the move within half a
// cell of a sample, so a descent within the tolerance of the move lies in the
// 3x3 cells around some sample.
function walkCells(move: Segment, visitCell: (cx: number, cy: number) => void): void {
  const length = Math.hypot(move.x1 - move.x0, move.y1 - move.y0);
  const steps = Math.max(1, Math.ceil(length / CELL_MM));
  const seen = new Set<number>();
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const sx = cellOf(move.x0 + (move.x1 - move.x0) * t);
    const sy = cellOf(move.y0 + (move.y1 - move.y0) * t);
    for (let cx = sx - 1; cx <= sx + 1; cx += 1) {
      for (let cy = sy - 1; cy <= sy + 1; cy += 1) {
        const key = cellKey(cx, cy);
        if (seen.has(key)) continue;
        seen.add(key);
        visitCell(cx, cy);
      }
    }
  }
}

type Segment = {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
};

function segmentAt(model: GcodeRenderModel, index: number): Segment {
  const base = index * 6;
  const at = (offset: number): number => model.positions[base + offset] ?? 0;
  return { x0: at(0), y0: at(1), z0: at(2), x1: at(3), y1: at(4), z1: at(5) };
}

// The move's Z at its point nearest (x, y), or null when it never comes within
// the tolerance. A Z-only move reaches its lower end there.
function zNearPoint(move: Segment, x: number, y: number): number | null {
  const dx = move.x1 - move.x0;
  const dy = move.y1 - move.y0;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - move.x0) * dx + (y - move.y0) * dy) / lengthSq));
  const distance = Math.hypot(move.x0 + dx * t - x, move.y0 + dy * t - y);
  if (distance > DESCENT_XY_TOLERANCE_MM) return null;
  if (lengthSq === 0) return Math.min(move.z0, move.z1);
  return move.z0 + (move.z1 - move.z0) * t;
}

function cellOf(value: number): number {
  return Math.floor(value / CELL_MM);
}

function cellKey(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET);
}
