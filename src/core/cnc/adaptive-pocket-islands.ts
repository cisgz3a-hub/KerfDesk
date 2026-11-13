import {
  FillRule,
  intersectD,
  isPositiveD,
  pointInPolygonD,
  PointInPolygonResult,
  type PathsD,
} from 'clipper2-ts';
import { tryVectorOp } from '../geometry/vector-path-tools';
import type { Polyline } from '../scene';
import {
  componentRegions,
  offsetAdaptivePaths,
  toPolyline,
  ADAPTIVE_FINISH_ARC_TOLERANCE_MM,
} from './adaptive-pocket-geometry';
import { sequencesForComponent, type AdaptivePocketSequence } from './adaptive-pocket-sequences';

type IslandResult =
  | {
      readonly ok: true;
      readonly sequences: ReadonlyArray<AdaptivePocketSequence>;
      // Every wall and island of the whole region. The planner runs each one
      // after the clearing beside it (ADR-154 Amendment 4).
      readonly cleanupRings: ReadonlyArray<Polyline>;
      readonly partitionCount: number;
    }
  | { readonly ok: false; readonly reason: string };
type CellResult =
  | {
      readonly ok: true;
      readonly sequences: ReadonlyArray<AdaptivePocketSequence>;
      readonly partitionCount: number;
    }
  | { readonly ok: false; readonly reason: string };
type Bounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

/**
 * Partition at island bounds so rectangular fixtures retain convex independent
 * clearing cells. A cell corner must lie on a wall or an island, where the
 * cleanup rings reach it. Where an island's x bound crossed another's y bound
 * in open stock, the four cells' corners there kept a full-depth pin of stock,
 * 0.858 r^2, that no pass removed (CNC audit v1 F2-P1-1). Such a pocket is cut
 * into strips across its shorter side instead: each island spans whole strips,
 * so no cut line crosses another (ADR-154 Amendment 4).
 */
export function adaptiveIslandSequences(
  region: PathsD,
  diameterMm: number,
  loadMm: number,
): IslandResult {
  const bounds = regionBounds(region);
  if (bounds === null) return fail('Island adaptive planning has no finite bounds.');
  let xs = islandCuts(region, bounds, 'x'),
    ys = islandCuts(region, bounds, 'y');
  if (cutsCrossInStock(region, xs, ys)) {
    if (bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY) ys = [bounds.minY, bounds.maxY];
    else xs = [bounds.minX, bounds.maxX];
  }
  if ((xs.length - 1) * (ys.length - 1) > 256)
    return fail('Island adaptive planning exceeds the 256-cell partition budget.');
  const sequences: AdaptivePocketSequence[] = [];
  let partitionCount = 0;
  for (let row = 1; row < ys.length; row += 1)
    for (let col = 1; col < xs.length; col += 1) {
      const cell = cellBounds(xs, ys, row, col);
      if (cell === null) continue;
      const result = cellSequences(region, cell, diameterMm, loadMm);
      if (!result.ok) return result;
      sequences.push(...result.sequences);
      partitionCount += result.partitionCount;
    }
  const finish = offsetAdaptivePaths(region, -diameterMm / 2, ADAPTIVE_FINISH_ARC_TOLERANCE_MM);
  if (finish === null) return fail('Island adaptive final wall cleanup could not be calculated.');
  const cleanupRings = [...finish.map(toPolyline), ...seamPasses(finish, xs, ys)];
  return sequences.length === 0
    ? fail('Island adaptive planning found no reachable partitions.')
    : { ok: true, sequences, cleanupRings, partitionCount };
}

// Shorter stretches of a seam than this are left: the walls' rings already
// sweep a disk round each end.
const MIN_SEAM_PASS_MM = 0.01;

/**
 * One pass along each inner cut line, wherever the bit centre can sit on it.
 * Each cell is cut on its own, and its finishing ring stops exactly one radius
 * short of the line, so the seam between two cells was cleared with zero
 * overlap: a bit 0.01 mm undersize left a full-depth foil along it (CNC audit
 * v3 N3-P3-1, ADR-154 Amendment 6). Growing the cells instead bit notches into
 * them beside each island, which split their clearing and refused the plan.
 * These passes run with the wall cleanup, after all the clearing beside them,
 * so they meet only what a seam left.
 */
function seamPasses(
  centreRegion: PathsD,
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
): Polyline[] {
  const passes: Polyline[] = [];
  for (const x of xs.slice(1, -1))
    for (const [from, to] of lineIntervals(centreRegion, 'x', x))
      passes.push(openPass({ x, y: from }, { x, y: to }));
  for (const y of ys.slice(1, -1))
    for (const [from, to] of lineIntervals(centreRegion, 'y', y))
      passes.push(openPass({ x: from, y }, { x: to, y }));
  return passes;
}

function openPass(from: { x: number; y: number }, to: { x: number; y: number }): Polyline {
  return { closed: false, points: [from, to] };
}

// Where the line `axis` = `at` lies inside the region, read even-odd: the
// region's crossings sorted along the line, paired in turn.
function lineIntervals(
  region: PathsD,
  axis: 'x' | 'y',
  at: number,
): ReadonlyArray<readonly [number, number]> {
  const crossings: number[] = [];
  for (const path of region)
    for (let i = 0; i < path.length; i += 1) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      if (a === undefined || b === undefined) continue;
      const [ua, va, ub, vb] = axis === 'x' ? [a.x, a.y, b.x, b.y] : [a.y, a.x, b.y, b.x];
      if (ua <= at === ub <= at) continue;
      crossings.push(va + ((at - ua) * (vb - va)) / (ub - ua));
    }
  crossings.sort((p, q) => p - q);
  const intervals: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const from = crossings[i] as number;
    const to = crossings[i + 1] as number;
    if (to - from >= MIN_SEAM_PASS_MM) intervals.push([from, to]);
  }
  return intervals;
}

// Whether two inner cut lines cross at a point of stock off every wall.
function cutsCrossInStock(
  region: PathsD,
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
): boolean {
  for (const x of xs.slice(1, -1))
    for (const y of ys.slice(1, -1)) {
      let inside = false,
        onWall = false;
      for (const path of region) {
        const result = pointInPolygonD({ x, y }, path, 3);
        if (result === PointInPolygonResult.IsOn) onWall = true;
        else if (result === PointInPolygonResult.IsInside) inside = !inside;
      }
      if (inside && !onWall) return true;
    }
  return false;
}

function cellSequences(
  region: PathsD,
  bounds: Bounds,
  diameterMm: number,
  loadMm: number,
): CellResult {
  const clip = [
    [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ],
  ];
  const partition = tryVectorOp(() => intersectD(region, clip, FillRule.NonZero, 3));
  if (partition.kind === 'error') return fail('Island adaptive partition geometry failed.');
  if (partition.value.some((path) => !isPositiveD(path)))
    return fail('An island could not be opened into a verified adaptive partition.');
  const components = componentRegions(partition.value),
    sequences: AdaptivePocketSequence[] = [];
  for (const component of components) {
    const result = sequencesForComponent(component, diameterMm, loadMm);
    if (!result.ok) return fail(`Island adaptive partition: ${result.reason}`);
    sequences.push(
      ...result.value.map((sequence) => ({
        ...sequence,
        seedRings: sequence.rings.slice(0, 1),
        rings: sequence.rings.slice(1),
      })),
    );
  }
  return { ok: true, sequences, partitionCount: components.length };
}

function islandCuts(region: PathsD, bounds: Bounds, axis: 'x' | 'y'): number[] {
  const cuts = axis === 'x' ? [bounds.minX, bounds.maxX] : [bounds.minY, bounds.maxY];
  for (const hole of region.filter((path) => !isPositiveD(path))) {
    const holeBounds = regionBounds([hole]);
    if (holeBounds !== null)
      cuts.push(
        ...(axis === 'x' ? [holeBounds.minX, holeBounds.maxX] : [holeBounds.minY, holeBounds.maxY]),
      );
  }
  return [...new Set(cuts.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function regionBounds(region: PathsD): Bounds | null {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const path of region)
    for (const point of path) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  return Number.isFinite(minX + minY + maxX + maxY) ? { minX, maxX, minY, maxY } : null;
}

function fail(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function cellBounds(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
  row: number,
  col: number,
): Bounds | null {
  const minX = xs[col - 1],
    maxX = xs[col],
    minY = ys[row - 1],
    maxY = ys[row];
  return minX === undefined || maxX === undefined || minY === undefined || maxY === undefined
    ? null
    : { minX, maxX, minY, maxY };
}
