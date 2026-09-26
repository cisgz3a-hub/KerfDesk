// Waterline contours of the tip surface (ADR-423). At one level z, the cutter
// may sit wherever its tip surface T is at or below z; the waterline rides the
// edge of that region, touching the wall.
//
// Marching squares over the sampled tip surface finds which grid edges the
// contour crosses; each crossing is then placed on the grid edge with the
// EXACT contact of a cutter centred there (heightmap-surface-contact.ts), not
// by interpolating samples. The bisection keeps a bracket whose inner end is
// always a proven position (tip at or below z), and that end is the vertex:
// every vertex clears the piecewise-linear model, exactly as a raster sample
// does. It only asks whether a position clears z, which the contact answers
// far faster than it measures a height. The chord between vertices is handled in relief-waterline-path.ts.
//
// Segments are oriented by the case topology alone, so they chain without
// floating-point ties: walking the square's corners counter-clockwise in map
// numbers, a segment runs from the edge where the walk leaves the region to the
// edge where it re-enters it. That puts the wall on the right of travel in map
// numbers.

import { partialCellCenter } from '../grid';
import type { Heightmap } from './heightmap';

export type WaterlinePoint = { readonly x: number; readonly y: number };

export type WaterlineContour = {
  readonly points: ReadonlyArray<WaterlinePoint>;
  readonly closed: boolean;
};

/** The exact contact of a cutter centred at (x, y) in map mm. */
export type WaterlineSurface = {
  // True when the tip may stand at z there without cutting the model.
  readonly clears: (x: number, y: number, z: number) => boolean;
  // The lowest tip there (slower; only for the rare lifted vertex).
  readonly tipAt: (x: number, y: number) => number;
};

// Crossing search: a bracket this narrow (mm) is half the 0.001 mm grid the
// G-code is written on.
const CROSSING_BRACKET_MM = 5e-4;
// First step out from the interpolated guess when bracketing a crossing.
const GUESS_BRACKET_MM = 0.002;

type Segment = { readonly from: number; readonly to: number };

type Level = {
  readonly map: Heightmap;
  readonly tip: Float32Array;
  readonly z: number;
  readonly surface: WaterlineSurface;
  readonly points: Map<number, WaterlinePoint>;
};

/**
 * The waterline contours at `z` through the squares `region` marks (1 per
 * square, indexed by its top-left sample), wall on the right of travel.
 */
export function waterlineContours(
  map: Heightmap,
  tip: Float32Array,
  z: number,
  region: Uint8Array,
  surface: WaterlineSurface,
): ReadonlyArray<WaterlineContour> {
  const level: Level = { map, tip, z, surface, points: new Map() };
  const segments: Segment[] = [];
  for (let j = 0; j + 1 < map.heightCells; j += 1) {
    for (let i = 0; i + 1 < map.widthCells; i += 1) {
      if (region[j * map.widthCells + i] === 1) appendSquareSegments(level, i, j, segments);
    }
  }
  return chainSegments(segments, level);
}

// Corners counter-clockwise in map numbers: a (i, j), b (i+1, j),
// c (i+1, j+1), d (i, j+1). Edge k joins corner k to corner k + 1.
function appendSquareSegments(level: Level, i: number, j: number, out: Segment[]): void {
  const w = level.map.widthCells;
  const top = j * w + i;
  const bottom = top + w;
  // Bit k set: corner k lies in the region.
  const mask =
    insideBit(level, top, 1) |
    insideBit(level, top + 1, 2) |
    insideBit(level, bottom + 1, 4) |
    insideBit(level, bottom, 8);
  const edges = [2 * top, 2 * (top + 1) + 1, 2 * bottom, 2 * top + 1];
  const leaves = transitions(mask, true);
  if (leaves.length === 0) return;
  // Saddle: the exact tip at the square's centre decides whether the region
  // joins across it (cut off each wall corner) or not (cut off each region
  // corner). Either way each leave pairs with an enter.
  const single = leaves.length === 1;
  const joined = !single && centerInside(level, i, j);
  for (const leave of leaves) {
    const enter = single ? (transitions(mask, false)[0] ?? 0) : (leave + (joined ? 1 : 3)) % 4;
    out.push({ from: edges[leave] ?? 0, to: edges[enter] ?? 0 });
  }
}

function insideBit(level: Level, index: number, bit: number): number {
  return (level.tip[index] ?? 0) <= level.z ? bit : 0;
}

// Edges k where the counter-clockwise walk leaves the region (corner k in,
// corner k + 1 out), or enters it when `leaving` is false.
function transitions(mask: number, leaving: boolean): number[] {
  const found: number[] = [];
  for (let k = 0; k < 4; k += 1) {
    const here = (mask >> k) & 1;
    const there = (mask >> ((k + 1) % 4)) & 1;
    if (here !== there && (here === 1) === leaving) found.push(k);
  }
  return found;
}

function centerInside(level: Level, i: number, j: number): boolean {
  const { map } = level;
  const x = (partialCellCenter(map, 'x', i) + partialCellCenter(map, 'x', i + 1)) / 2;
  const y = (partialCellCenter(map, 'y', j) + partialCellCenter(map, 'y', j + 1)) / 2;
  return level.surface.clears(x, y, level.z);
}

function chainSegments(segments: ReadonlyArray<Segment>, level: Level): WaterlineContour[] {
  const next = new Map<number, number>();
  const entered = new Set<number>();
  segments.forEach((segment, index) => {
    next.set(segment.from, index);
    entered.add(segment.to);
  });
  const used = new Uint8Array(segments.length);
  const contours: WaterlineContour[] = [];
  // Open contours start where no segment arrives; what remains is closed.
  for (const [index, segment] of segments.entries()) {
    if (!entered.has(segment.from)) contours.push(walk(index, segments, next, used, level));
  }
  for (let index = 0; index < segments.length; index += 1) {
    if (used[index] === 0) contours.push(walk(index, segments, next, used, level));
  }
  return contours.filter((contour) => contour.points.length >= 2);
}

function walk(
  start: number,
  segments: ReadonlyArray<Segment>,
  next: ReadonlyMap<number, number>,
  used: Uint8Array,
  level: Level,
): WaterlineContour {
  const keys: number[] = [];
  let index: number | undefined = start;
  let closed = false;
  while (index !== undefined) {
    const segment = segments[index];
    if (segment === undefined) break;
    if (used[index] === 1) {
      closed = index === start;
      break;
    }
    used[index] = 1;
    if (keys.length === 0) keys.push(segment.from);
    keys.push(segment.to);
    index = next.get(segment.to);
  }
  if (closed) keys.pop();
  return { points: keys.map((key) => crossing(level, key)), closed };
}

// The vertex where the contour crosses grid edge `key`, cached per level.
function crossing(level: Level, key: number): WaterlinePoint {
  const cached = level.points.get(key);
  if (cached !== undefined) return cached;
  const { map, tip, z } = level;
  const cell = key >> 1;
  const other = key & 1 ? cell + map.widthCells : cell + 1;
  const [inner, outer] = (tip[cell] ?? 0) <= z ? [cell, other] : [other, cell];
  const innerTip = tip[inner] ?? 0;
  const guess = (z - innerTip) / ((tip[outer] ?? 0) - innerTip);
  const point = placeCrossing(level, samplePoint(map, inner), samplePoint(map, outer), guess);
  level.points.set(key, point);
  return point;
}

function samplePoint(map: Heightmap, index: number): WaterlinePoint {
  const i = index % map.widthCells;
  return {
    x: partialCellCenter(map, 'x', i),
    y: partialCellCenter(map, 'y', (index - i) / map.widthCells),
  };
}

// Bisection along the edge from `inner` (tip at or below z) to `outer` (above
// it). The search starts where the straight line between the two samples'
// exact tips meets z and widens a bracket around that guess, since the tip
// surface rarely strays far from it within one cell. The returned point is
// always the inner end of the final bracket, so its exact tip never exceeds z.
function placeCrossing(
  level: Level,
  inner: WaterlinePoint,
  outer: WaterlinePoint,
  guess: number,
): WaterlinePoint {
  const length = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  const clears = (t: number): boolean =>
    level.surface.clears(
      inner.x + t * (outer.x - inner.x),
      inner.y + t * (outer.y - inner.y),
      level.z,
    );
  let { low, high } = guessedBracket(clears, guess, GUESS_BRACKET_MM / length);
  while ((high - low) * length > CROSSING_BRACKET_MM) {
    const t = (low + high) / 2;
    if (clears(t)) low = t;
    else high = t;
  }
  return { x: inner.x + low * (outer.x - inner.x), y: inner.y + low * (outer.y - inner.y) };
}

// A bracket [low, high] of the edge parameter with a clear low end and a
// blocked high end (0 and 1 are known to be), found by stepping out from
// `guess` in doubling steps.
function guessedBracket(
  clears: (t: number) => boolean,
  guess: number,
  firstStep: number,
): { readonly low: number; readonly high: number } {
  if (!(guess > 0 && guess < 1)) return { low: 0, high: 1 };
  let step = firstStep;
  if (clears(guess)) {
    let low = guess;
    while (low + step < 1 && clears(low + step)) {
      low += step;
      step *= 2;
    }
    return { low, high: Math.min(1, low + step) };
  }
  let high = guess;
  while (high - step > 0 && !clears(high - step)) {
    high -= step;
    step *= 2;
  }
  return { low: Math.max(0, high - step), high };
}
