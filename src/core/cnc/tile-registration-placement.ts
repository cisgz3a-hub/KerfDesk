// Where the tile registration bores go (ADR-433 Amendment, N4-P1-1 / AC-5).
//
// Each seam between two adjacent tiles gets its bores at IDENTICAL stock
// positions in both tiles, so dowel pins re-index the stock. A bore must not
// land in a part, in any cut, or off the board: it is searched for along the
// seam, inside the overlap strip and the stock, clear of every cut footprint
// (the cutter's radius plus the bore's radius plus a wall) and outside every
// ring a cut goes round (a part, a pocket or a hole), whatever its lead, tabs
// or ramp (ringsOf). The two clear spots furthest apart along the seam win,
// so the pins square the stock as well as locate it.
// The stock margin at a seam's ends is part of the search. A seam with no
// clear spot gets no bore and a warning that names it; it is never drilled
// through the work. An open outline whose ends nearly meet (as the tab
// compiler counts it) is kept clear like a part; a bore inside any other open
// outline is named (tile-registration-open-outlines.ts, N8-P1-1).

import { cncPassXyPoints, type CncGroup, type CncPass, type Job } from '../job';
import type { CncStock, Vec2 } from '../scene';
import type { CncTile } from './cnc-tile';
import {
  openOutlineBoreWarnings,
  readOpenOutlines,
  type RegistrationLayers,
} from './tile-registration-open-outlines';
import { ringsOf } from './tile-registration-rings';

/** Wall left between a registration bore and any cut, part edge or board edge. */
export const REGISTRATION_HOLE_CLEARANCE_MM = 2;
const ALONG_STEP_MM = 0.5;
const ACROSS_STEP_MM = 1;
const MAX_ALONG_SAMPLES = 4000;
const MAX_ACROSS_LINES = 41;
/** The layer id registration groups compile under; never an obstacle to itself. */
export const TILE_REGISTRATION_LAYER_ID = 'tile-registration';

/** One seam between two adjacent tiles and the bores both of them drill. */
export type RegistrationSeam = {
  readonly orientation: 'vertical' | 'horizontal';
  readonly first: { readonly row: number; readonly col: number };
  readonly second: { readonly row: number; readonly col: number };
  /** Stock (machine) coordinates, identical in both tiles. */
  readonly holes: ReadonlyArray<Vec2>;
};

export type RegistrationPlacement = {
  readonly seams: ReadonlyArray<RegistrationSeam>;
  /** One line per seam that got fewer than two bores, naming the seam. */
  readonly warnings: ReadonlyArray<string>;
};

type Segment = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly clearMm: number;
};

type Loop = {
  readonly points: ReadonlyArray<Vec2>;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Obstacles = {
  readonly segments: ReadonlyArray<Segment>;
  readonly loops: ReadonlyArray<Loop>;
};

type Axis = {
  readonly vertical: boolean;
  readonly across: (p: Vec2) => number;
  readonly along: (p: Vec2) => number;
  readonly point: (across: number, along: number) => Vec2;
};

const VERTICAL_AXIS: Axis = {
  vertical: true,
  across: (p) => p.x,
  along: (p) => p.y,
  point: (across, along) => ({ x: across, y: along }),
};

const HORIZONTAL_AXIS: Axis = {
  vertical: false,
  across: (p) => p.y,
  along: (p) => p.x,
  point: (across, along) => ({ x: along, y: across }),
};

/** One-based tile label, as the tile files name it. */
export function tileLabel(tile: { readonly row: number; readonly col: number }): string {
  return `r${tile.row + 1}-c${tile.col + 1}`;
}

/**
 * Place the registration bores of every seam of a tile grid. `job` is the
 * untiled job in stock coordinates (the same frame as the tile rectangles
 * and the stock's originOffset).
 */
export function placeTileRegistrationHoles(
  job: Job,
  tiles: ReadonlyArray<CncTile>,
  stock: CncStock,
  holeDiameterMm: number,
  layers: RegistrationLayers = [],
): RegistrationPlacement {
  const holeRadiusMm = holeDiameterMm / 2;
  const outlines = readOpenOutlines(job, TILE_REGISTRATION_LAYER_ID, layers);
  const obstacles = collectObstacles(job, holeRadiusMm, outlines.closing);
  const byIndex = new Map(tiles.map((tile) => [`${tile.row},${tile.col}`, tile]));
  const placed: Vec2[] = [];
  const seams: RegistrationSeam[] = [];
  const warnings: string[] = [];
  for (const tile of tiles) {
    for (const [axis, neighbour] of [
      [VERTICAL_AXIS, byIndex.get(`${tile.row},${tile.col + 1}`)],
      [HORIZONTAL_AXIS, byIndex.get(`${tile.row + 1},${tile.col}`)],
    ] as const) {
      if (neighbour === undefined) continue;
      const holes = seamHoles(axis, tile, neighbour, {
        obstacles,
        stock,
        holeRadiusMm,
        placed,
      });
      placed.push(...holes);
      const seam: RegistrationSeam = {
        orientation: axis.vertical ? 'vertical' : 'horizontal',
        first: { row: tile.row, col: tile.col },
        second: { row: neighbour.row, col: neighbour.col },
        holes,
      };
      seams.push(seam);
      const warning = seamWarning(seam);
      if (warning !== null) warnings.push(warning);
    }
  }
  warnings.push(...openOutlineBoreWarnings(outlines.open, placed));
  return { seams, warnings };
}

/** The bores one tile drills: those of every seam it shares. */
export function registrationHolesForTile(
  placement: RegistrationPlacement,
  tile: { readonly row: number; readonly col: number },
): ReadonlyArray<Vec2> {
  return placement.seams.flatMap((seam) =>
    (seam.first.row === tile.row && seam.first.col === tile.col) ||
    (seam.second.row === tile.row && seam.second.col === tile.col)
      ? seam.holes
      : [],
  );
}

function seamName(seam: RegistrationSeam): string {
  return `the seam between tiles ${tileLabel(seam.first)} and ${tileLabel(seam.second)}`;
}

function seamWarning(seam: RegistrationSeam): string | null {
  if (seam.holes.length === 0) {
    return (
      `No registration hole fits on ${seamName(seam)}: its overlap strip has no spot on the ` +
      'stock clear of every toolpath and outside every outline, so that seam gets no hole. Register it another way, ' +
      'or widen the overlap or the stock margin.'
    );
  }
  if (seam.holes.length === 1) {
    return (
      `Only one registration hole fits on ${seamName(seam)}. One pin locates the stock but ` +
      'does not square it; check the stock is square before cutting the next tile.'
    );
  }
  return null;
}

type SeamContext = {
  readonly obstacles: Obstacles;
  readonly stock: CncStock;
  readonly holeRadiusMm: number;
  readonly placed: ReadonlyArray<Vec2>;
};

type Candidate = { readonly point: Vec2; readonly along: number };

function seamHoles(
  axis: Axis,
  first: CncTile,
  second: CncTile,
  context: SeamContext,
): ReadonlyArray<Vec2> {
  const { stock, holeRadiusMm } = context;
  const edgeMm = holeRadiusMm + REGISTRATION_HOLE_CLEARANCE_MM;
  const stockMin = stock.originOffset;
  const stockMax = { x: stockMin.x + stock.widthMm, y: stockMin.y + stock.heightMm };
  // The bore centre sits in the overlap strip, so both tiles reach it.
  const stripLow = Math.max(axis.across(rectMin(second)), axis.across(stockMin) + edgeMm);
  const stripHigh = Math.min(axis.across(rectMax(first)), axis.across(stockMax) - edgeMm);
  const alongLow = Math.max(axis.along(rectMin(first)), axis.along(stockMin) + edgeMm);
  const alongHigh = Math.min(axis.along(rectMax(first)), axis.along(stockMax) - edgeMm);
  if (!(stripLow <= stripHigh) || !(alongLow <= alongHigh)) return [];
  const spacingMm = 2 * holeRadiusMm + REGISTRATION_HOLE_CLEARANCE_MM;
  let low: Candidate | null = null;
  let high: Candidate | null = null;
  for (const across of acrossLines(stripLow, stripHigh)) {
    const found = lineExtremes(axis, across, alongLow, alongHigh, context);
    if (found === null) continue;
    if (low === null || found.low.along < low.along) low = found.low;
    if (high === null || found.high.along > high.along) high = found.high;
  }
  if (low === null || high === null) return [];
  if (high.along - low.along < spacingMm) return [low.point];
  return [low.point, high.point];
}

function rectMin(tile: CncTile): Vec2 {
  return { x: tile.rect.minX, y: tile.rect.minY };
}

function rectMax(tile: CncTile): Vec2 {
  return { x: tile.rect.maxX, y: tile.rect.maxY };
}

// The strip's middle first, then outwards, so a centred bore wins a tie.
function acrossLines(low: number, high: number): ReadonlyArray<number> {
  const middle = (low + high) / 2;
  const lines = [middle];
  for (let k = 1; lines.length < MAX_ACROSS_LINES; k += 1) {
    const offset = k * ACROSS_STEP_MM;
    if (middle - offset < low && middle + offset > high) break;
    if (middle + offset <= high) lines.push(middle + offset);
    if (middle - offset >= low) lines.push(middle - offset);
  }
  return lines;
}

function lineExtremes(
  axis: Axis,
  across: number,
  alongLow: number,
  alongHigh: number,
  context: SeamContext,
): { readonly low: Candidate; readonly high: Candidate } | null {
  const inside = insideIntervals(axis, across, context.obstacles.loops);
  const near = segmentsNearLine(axis, across, alongLow, alongHigh, context.obstacles.segments);
  const span = alongHigh - alongLow;
  const step = Math.max(ALONG_STEP_MM, span / MAX_ALONG_SAMPLES);
  const count = Math.max(1, Math.ceil(span / step));
  const clear = (along: number): Candidate | null => {
    const point = axis.point(across, along);
    if (isInside(inside, along)) return null;
    if (!clearOfSegments(point, near)) return null;
    if (!clearOfPlaced(point, context.placed, context.holeRadiusMm)) return null;
    return { point, along };
  };
  let low: Candidate | null = null;
  for (let index = 0; index <= count && low === null; index += 1) {
    low = clear(Math.min(alongHigh, alongLow + index * step));
  }
  if (low === null) return null;
  let high: Candidate | null = null;
  for (let index = 0; index <= count && high === null; index += 1) {
    const along = Math.max(alongLow, alongHigh - index * step);
    if (along < low.along) break;
    high = clear(along);
  }
  return { low, high: high ?? low };
}

function clearOfSegments(point: Vec2, segments: ReadonlyArray<Segment>): boolean {
  for (const segment of segments) {
    if (pointSegmentDistanceSq(point, segment) < segment.clearMm * segment.clearMm) return false;
  }
  return true;
}

function clearOfPlaced(point: Vec2, placed: ReadonlyArray<Vec2>, holeRadiusMm: number): boolean {
  const minimum = 2 * holeRadiusMm + REGISTRATION_HOLE_CLEARANCE_MM;
  return placed.every((hole) => Math.hypot(hole.x - point.x, hole.y - point.y) >= minimum);
}

function pointSegmentDistanceSq(p: Vec2, s: Segment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / lengthSq));
  const ex = s.ax + t * dx - p.x;
  const ey = s.ay + t * dy - p.y;
  return ex * ex + ey * ey;
}

function segmentsNearLine(
  axis: Axis,
  across: number,
  alongLow: number,
  alongHigh: number,
  segments: ReadonlyArray<Segment>,
): ReadonlyArray<Segment> {
  return segments.filter((segment) => {
    const a = { x: segment.ax, y: segment.ay };
    const b = { x: segment.bx, y: segment.by };
    const c = segment.clearMm;
    return (
      Math.min(axis.across(a), axis.across(b)) - c <= across &&
      Math.max(axis.across(a), axis.across(b)) + c >= across &&
      Math.min(axis.along(a), axis.along(b)) - c <= alongHigh &&
      Math.max(axis.along(a), axis.along(b)) + c >= alongLow
    );
  });
}

// Along-seam intervals of this line inside any closed cut loop (non-zero
// winding, so a ring ramped round more than once still reads as inside).
function insideIntervals(
  axis: Axis,
  across: number,
  loops: ReadonlyArray<Loop>,
): ReadonlyArray<readonly [number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const loop of loops) {
    const low = axis.vertical ? loop.minX : loop.minY;
    const high = axis.vertical ? loop.maxX : loop.maxY;
    if (across < low || across > high) continue;
    intervals.push(...windingIntervals(loopCrossings(axis, across, loop.points)));
  }
  intervals.sort((p, q) => p[0] - q[0]);
  return intervals;
}

// Where the line crosses the loop, and which way (+1 / -1), sorted along it.
function loopCrossings(
  axis: Axis,
  across: number,
  points: ReadonlyArray<Vec2>,
): ReadonlyArray<readonly [number, number]> {
  const crossings: Array<readonly [number, number]> = [];
  for (const [index, a] of points.entries()) {
    const b = points[(index + 1) % points.length] as Vec2;
    const aAcross = axis.across(a);
    const bAcross = axis.across(b);
    const upward = aAcross <= across && across < bAcross;
    const downward = bAcross <= across && across < aAcross;
    if (!upward && !downward) continue;
    const t = (across - aAcross) / (bAcross - aAcross);
    crossings.push([axis.along(a) + t * (axis.along(b) - axis.along(a)), upward ? 1 : -1]);
  }
  return crossings.sort((p, q) => p[0] - q[0]);
}

function windingIntervals(
  crossings: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<[number, number]> {
  const intervals: Array<[number, number]> = [];
  let winding = 0;
  for (const [at, direction] of crossings) {
    const before = winding;
    winding += direction;
    if (before === 0 && winding !== 0) intervals.push([at, at]);
    const open = intervals[intervals.length - 1];
    if (before !== 0 && winding === 0 && open !== undefined) open[1] = at;
  }
  return intervals;
}

function isInside(intervals: ReadonlyArray<readonly [number, number]>, along: number): boolean {
  return intervals.some(([low, high]) => along >= low && along <= high);
}

// An effectively closed open outline (N8-P1-1) is kept clear like a part.
function collectObstacles(
  job: Job,
  holeRadiusMm: number,
  closing: ReadonlyArray<ReadonlyArray<Vec2>>,
): Obstacles {
  const segments: Segment[] = [];
  const loops: Loop[] = closing.map(loopOf);
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.layerId === TILE_REGISTRATION_LAYER_ID) continue;
    const clearMm = cutRadiusMm(group) + holeRadiusMm + REGISTRATION_HOLE_CLEARANCE_MM;
    for (const pass of group.passes) addPassObstacles(pass, clearMm, segments, loops);
  }
  return { segments, loops };
}

function addPassObstacles(pass: CncPass, clearMm: number, segments: Segment[], loops: Loop[]) {
  const points = cncPassXyPoints(pass);
  if (points.length === 0) return;
  const closed = pass.kind !== 'helical-contour' && pass.closed;
  const last = closed ? points.length : points.length - 1;
  for (let index = 0; index < Math.max(1, last); index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] ?? a;
    segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, clearMm });
  }
  if (closed && points.length >= 3) loops.push(loopOf(points));
  else for (const ring of ringsOf(points)) loops.push(loopOf(ring));
  if (pass.kind === 'helical-contour' && pass.polyline.length >= 3) {
    loops.push(loopOf(pass.polyline));
  }
}

function cutRadiusMm(group: CncGroup): number {
  const radius = group.toolDiameterMm / 2;
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

function loopOf(points: ReadonlyArray<Vec2>): Loop {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { points: points.map((point) => ({ x: point.x, y: point.y })), minX, minY, maxX, maxY };
}
