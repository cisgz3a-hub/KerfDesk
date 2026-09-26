// Relief roughing Z levels (ADR-422). The layer's depth-per-pass ladder cuts
// the stock in even slices, but a slice boundary rarely lands on the model's
// own flats. Everything between a flat and the level above it stayed on as a
// terrace for the finishing bit: on the ADR-412 bench relief 1.0 mm on the
// open floor and on the plateau top, twice the allowance.
//
// Two additions, both on the dilated tip field, so each new level only
// reaches where the tip may already go:
// - The floor. Ladder levels below the deepest tip cut nothing; they are
//   replaced by one level at that tip, the floor plus its allowance.
// - Flats. A height that a footprint-sized area of the tip field shares,
//   lying clearly between two levels, gets a level of its own. It clears only
//   its band, the cells the next level down will not reach, so it adds one
//   thin slice where the flat is instead of re-clearing everything deeper.

import type { Heightmap } from './heightmap';

// Cells whose tips round to the same 0.1 µm share a flat.
const FLAT_BUCKETS_PER_MM = 10_000;
// A flat closer than this below a level keeps only negligible extra stock.
const MIN_FLAT_STEP_MM = 0.05;
const LEVEL_EPS = 1e-6;

export type ReliefRoughingLevel = {
  readonly zMm: number;
  // Only cells deeper than this (the next level down) are cleared at a flat
  // level; null for a ladder level, which clears every cell it may reach.
  readonly bandFloorMm: number | null;
  // Where the stock under this level's region stands before the level cuts:
  // the ladder level above it.
  readonly sliceTopMm: number;
};

export function reliefRoughingLevels(
  map: Heightmap,
  dilated: Float32Array,
  ladder: ReadonlyArray<number>,
  toolRadiusMm: number,
): ReadonlyArray<ReliefRoughingLevel> {
  const floorMm = deepestTip(map, dilated);
  if (!(floorMm < -LEVEL_EPS)) return [];
  const planned = ladder.filter((z) => z > floorMm + LEVEL_EPS);
  if (ladder.some((z) => z <= floorMm + LEVEL_EPS)) planned.push(floorMm);
  const flats = flatHeights(map, dilated, toolRadiusMm).filter((flat) =>
    isBetweenLevels(flat, planned),
  );
  const all = [
    ...planned.map((z) => ({ z, flat: false })),
    ...flats.map((z) => ({ z, flat: true })),
  ];
  all.sort((a, b) => b.z - a.z);
  const levels: ReliefRoughingLevel[] = [];
  let sliceTopMm = 0;
  for (let index = 0; index < all.length; index += 1) {
    const level = all[index];
    if (level === undefined) continue;
    const below = all[index + 1];
    levels.push({
      zMm: level.z,
      bandFloorMm: level.flat ? (below?.z ?? floorMm) : null,
      sliceTopMm,
    });
    if (!level.flat) sliceTopMm = level.z;
  }
  return levels;
}

function deepestTip(map: Heightmap, dilated: Float32Array): number {
  let deepest = 0;
  for (let index = 0; index < dilated.length; index += 1) {
    if (map.inclusion?.[index] === 0) continue;
    deepest = Math.min(deepest, dilated[index] ?? 0);
  }
  return deepest;
}

// Tip heights shared by a footprint-sized area: counted by the cells whose four
// neighbours share their bucket, so a contour line of equal tips (a pyramid's
// ring) never passes for a flat. Each flat is reported as the highest tip in
// its bucket, so the whole flat lies at or below its level.
function flatHeights(
  map: Heightmap,
  dilated: Float32Array,
  toolRadiusMm: number,
): ReadonlyArray<number> {
  const minInteriorCells = Math.max(1, Math.ceil(Math.PI * (toolRadiusMm / map.mmPerCell) ** 2));
  const keys = flatKeys(map, dilated);
  const buckets = new Map<number, { interior: number; highest: number }>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] ?? Number.NaN;
    if (Number.isNaN(key)) continue;
    const z = dilated[index] ?? 0;
    const interior = isInteriorOfFlat(map, keys, index, key) ? 1 : 0;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { interior, highest: z });
    else {
      bucket.interior += interior;
      bucket.highest = Math.max(bucket.highest, z);
    }
  }
  const flats: number[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.interior >= minInteriorCells) flats.push(bucket.highest);
  }
  return flats;
}

// Each included cell below stock top keyed by its rounded tip; NaN elsewhere.
function flatKeys(map: Heightmap, dilated: Float32Array): Float64Array {
  const keys = new Float64Array(dilated.length).fill(Number.NaN);
  for (let index = 0; index < dilated.length; index += 1) {
    const z = dilated[index] ?? 0;
    if (map.inclusion?.[index] === 0 || !(z < -LEVEL_EPS)) continue;
    keys[index] = Math.round(z * FLAT_BUCKETS_PER_MM);
  }
  return keys;
}

function isInteriorOfFlat(map: Heightmap, keys: Float64Array, index: number, key: number): boolean {
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

// A flat earns a level when the lowest ladder level that reaches it (the one
// that would otherwise leave it stock) sits clearly above it.
function isBetweenLevels(flatMm: number, planned: ReadonlyArray<number>): boolean {
  let reaching = 0;
  for (const z of planned) {
    if (z >= flatMm - LEVEL_EPS) reaching = Math.min(reaching, z);
  }
  return reaching - flatMm > MIN_FLAT_STEP_MM;
}
