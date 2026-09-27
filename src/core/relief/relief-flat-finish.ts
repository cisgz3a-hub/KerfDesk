// Flat finishing by the roughing end mill (ADR-450). Roughing leaves its
// allowance on every flat, and the finishing ball then rasters the flats at
// its scallop row spacing: on a plaque whose relief stands on a wide
// background, most of the finishing time goes on a floor a flat end mill
// could cut to depth in a few rings. Fusion finishes such areas with its Flat
// pass; Vectric and Carveco users draw a separate pocket for the background.
//
// Here a flat is a height the model itself shares over at least a
// footprint-sized area, counted by interior cells as ADR-422 counts its tip
// flats. It is cut at exactly its height on the zero-lift tip field: the
// cutter widened by the allowance (and the dual-grid clearance) but not lifted
// by it, so the cut keeps the allowance off every wall and takes it off the
// flat. Its region is the tip field's cells in the flat's bucket, in the
// pieces that hold a cell of the model's flat, so a cutter merely resting on a
// peak or crossing the height on a slope adds nothing.
//
// Roughing already has a level one allowance above most flats: the floor,
// ADR-422's flat levels, or a fine level standing in for one. That level's
// region is the same set of tip positions, so when cutting it at the flat
// itself stays within one depth per pass of its slice top, it simply cuts
// there. Only the other flats get a level of their own, after all roughing.
//
// The level also reports what it finished, for the finishing ball to skip:
// every cell the end mill's bottom sweeps at the flat's height, taken as the
// region grown by the cutter radius less two cells (ring 0 lies within 0.75
// cells of a region cell, and a finishing sample within 0.71 cells of a
// roughing cell's centre).

import { partialCellIndex, partialDualCoordinate, type PartialCellGrid } from '../grid';
import type { Polyline } from '../scene';
import type { Heightmap } from './heightmap';
import { marchingSquares } from './marching-squares';
import type { ReliefRoughingLevel } from './relief-roughing-levels';

// Heights rounding to the same 0.1 µm share a flat (as ADR-422's buckets).
const FLAT_BUCKETS_PER_MM = 10_000;
const LEVEL_EPS = 1e-6;
// Roughing cells between a region cell's centre and the nearest point the
// end mill's bottom is proven to reach.
const SWEEP_MARGIN_CELLS = 2;
// A roughing level one allowance above a flat: bucket width plus Float32 noise.
const FLAT_MATCH_MM = 2e-4;

export type ReliefFlatLevel = {
  readonly zMm: number;
  // The region's cells: where the cutter's tip may stand at zMm.
  readonly mask: Uint8Array;
  readonly contours: ReadonlyArray<Polyline>;
};

/** Where the flat levels took the model to its exact height. */
export type ReliefFinishedFlats = {
  readonly grid: PartialCellGrid;
  // Per roughing cell, the height the lowest flat level cut it to; NaN where
  // no flat level reached it.
  readonly depthMm: Float32Array;
};

/**
 * One level per model flat below stock top, top down, on `tip`: the zero-lift
 * tip field of the cutter widened by the allowance.
 */
export function reliefFlatLevels(
  map: Heightmap,
  tip: Float32Array,
  toolRadiusMm: number,
): ReadonlyArray<ReliefFlatLevel> {
  const minInteriorCells = Math.max(1, Math.ceil(Math.PI * (toolRadiusMm / map.mmPerCell) ** 2));
  const modelKeys = bucketKeys(map, map.depth);
  const tipKeys = bucketKeys(map, tip);
  const levels: ReliefFlatLevel[] = [];
  for (const key of flatKeys(map, modelKeys, minInteriorCells)) {
    const mask = new Uint8Array(tip.length);
    for (let index = 0; index < tip.length; index += 1) {
      if (tipKeys[index] === key) mask[index] = 1;
    }
    keepPiecesHoldingFlat(map, mask, modelKeys, key);
    let zMm = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index] === 1) zMm = Math.max(zMm, tip[index] ?? 0);
    }
    if (!(zMm < -LEVEL_EPS)) continue;
    levels.push({ zMm, mask, contours: maskContoursMm(map, mask) });
  }
  return levels.sort((a, b) => b.zMm - a.zMm);
}

/**
 * Which roughing levels cut straight to a flat (level index to the height it
 * cuts at), and the flats left for levels of their own. A roughing level takes
 * a flat when it sits one allowance above it, is a band level or the floor
 * (the deepest level), and the cut stays within `maxCutMm` of its slice top.
 */
export function mergeFlatLevels(
  levels: ReadonlyArray<ReliefRoughingLevel>,
  flats: ReadonlyArray<ReliefFlatLevel>,
  allowanceMm: number,
  maxCutMm: number,
): { readonly cutZMm: ReadonlyMap<number, number>; readonly separate: ReliefFlatLevel[] } {
  const cutZMm = new Map<number, number>();
  const separate: ReliefFlatLevel[] = [];
  for (const flat of flats) {
    const index = levels.findIndex((level, i) => {
      const cut = level.zMm - allowanceMm;
      return (
        !cutZMm.has(i) &&
        (level.bandFloorMm !== null || i === levels.length - 1) &&
        Math.abs(cut - flat.zMm) <= FLAT_MATCH_MM &&
        level.sliceTopMm - cut <= maxCutMm + LEVEL_EPS
      );
    });
    const level = levels[index];
    if (level === undefined) separate.push(flat);
    else cutZMm.set(index, level.zMm - allowanceMm);
  }
  return { cutZMm, separate };
}

/** The cells each finished level's end mill swept, at its height. */
export function finishedFlatDepths(
  map: Heightmap,
  levels: ReadonlyArray<{ readonly zMm: number; readonly mask: Uint8Array }>,
  toolRadiusMm: number,
): ReliefFinishedFlats {
  const { widthCells, heightCells } = map;
  const depthMm = new Float32Array(widthCells * heightCells).fill(Number.NaN);
  const reach = toolRadiusMm / map.mmPerCell - SWEEP_MARGIN_CELLS;
  const offsets = diskOffsets(Math.max(0, reach));
  for (const level of levels) {
    for (let y = 0; y < heightCells; y += 1) {
      for (let x = 0; x < widthCells; x += 1) {
        if (level.mask[y * widthCells + x] !== 1) continue;
        for (const [dx, dy] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= widthCells || ny >= heightCells) continue;
          const index = ny * widthCells + nx;
          const current = depthMm[index] ?? Number.NaN;
          if (!(current <= level.zMm)) depthMm[index] = level.zMm;
        }
      }
    }
  }
  return {
    grid: {
      widthCells,
      heightCells,
      widthMm: map.widthMm,
      heightMm: map.heightMm,
      mmPerCell: map.mmPerCell,
    },
    depthMm,
  };
}

/** The finished height at (x, y) in map mm, or NaN where none is known. */
export function finishedFlatDepthAt(finished: ReliefFinishedFlats, x: number, y: number): number {
  const col = partialCellIndex(finished.grid, 'x', x);
  const row = partialCellIndex(finished.grid, 'y', y);
  if (col === null || row === null) return Number.NaN;
  return finished.depthMm[row * finished.grid.widthCells + col] ?? Number.NaN;
}

// Each included cell below stock top keyed by its rounded height; NaN elsewhere.
function bucketKeys(map: Heightmap, heights: Float32Array): Float64Array {
  const keys = new Float64Array(heights.length).fill(Number.NaN);
  for (let index = 0; index < heights.length; index += 1) {
    const z = heights[index] ?? 0;
    if (map.inclusion?.[index] === 0 || !(z < -LEVEL_EPS)) continue;
    keys[index] = Math.round(z * FLAT_BUCKETS_PER_MM);
  }
  return keys;
}

// Buckets with at least a footprint's worth of interior cells: cells whose
// four neighbours share their bucket.
function flatKeys(
  map: Heightmap,
  keys: Float64Array,
  minInteriorCells: number,
): ReadonlyArray<number> {
  const interior = new Map<number, number>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] ?? Number.NaN;
    if (!Number.isNaN(key) && isInterior(map, keys, index, key)) {
      interior.set(key, (interior.get(key) ?? 0) + 1);
    }
  }
  const flats: number[] = [];
  for (const [key, count] of interior) if (count >= minInteriorCells) flats.push(key);
  return flats;
}

function isInterior(map: Heightmap, keys: Float64Array, index: number, key: number): boolean {
  const { widthCells } = map;
  const x = index % widthCells;
  if (x === 0 || x === widthCells - 1) return false;
  return (
    keys[index - 1] === key &&
    keys[index + 1] === key &&
    keys[index - widthCells] === key &&
    keys[index + widthCells] === key
  );
}

// Clears every 8-connected piece of the mask that holds no interior cell of
// the model's flat.
function keepPiecesHoldingFlat(
  map: Heightmap,
  mask: Uint8Array,
  modelKeys: Float64Array,
  key: number,
): void {
  const seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || seen[start] === 1) continue;
    const piece = floodPiece(map, mask, seen, start);
    if (!piece.some((index) => isInterior(map, modelKeys, index, key))) {
      for (const index of piece) mask[index] = 0;
    }
  }
}

// The 8-connected piece of the mask holding `start`, marking it seen.
function floodPiece(
  map: Heightmap,
  mask: Uint8Array,
  seen: Uint8Array,
  start: number,
): ReadonlyArray<number> {
  const { widthCells, heightCells } = map;
  const piece = [start];
  seen[start] = 1;
  for (const index of piece) {
    const x = index % widthCells;
    const y = (index - x) / widthCells;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * widthCells + nx;
        if (nx < 0 || ny < 0 || nx >= widthCells || ny >= heightCells) continue;
        if (mask[next] !== 1 || seen[next] === 1) continue;
        seen[next] = 1;
        piece.push(next);
      }
    }
  }
  return piece;
}

/** A cell mask's marching-squares contours in map mm. */
export function maskContoursMm(map: Heightmap, mask: Uint8Array): ReadonlyArray<Polyline> {
  return marchingSquares(mask, map.widthCells, map.heightCells).map((contour) => ({
    closed: true,
    points: contour.points.map((p) => ({
      x: partialDualCoordinate(map, 'x', p.x),
      y: partialDualCoordinate(map, 'y', p.y),
    })),
  }));
}

function diskOffsets(radiusCells: number): ReadonlyArray<readonly [number, number]> {
  const span = Math.floor(radiusCells);
  const offsets: Array<readonly [number, number]> = [];
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      if (dx * dx + dy * dy <= radiusCells * radiusCells) offsets.push([dx, dy]);
    }
  }
  return offsets;
}
