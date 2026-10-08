import { FillRule, intersectD, isPositiveD, type PathsD } from 'clipper2-ts';
import { tryVectorOp } from '../geometry/vector-path-tools';
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
      readonly partitionCount: number;
    }
  | { readonly ok: false; readonly reason: string };
type Bounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

/** Partition at island bounds so rectangular fixtures retain convex independent clearing cells. */
export function adaptiveIslandSequences(
  region: PathsD,
  diameterMm: number,
  loadMm: number,
): IslandResult {
  const bounds = regionBounds(region);
  if (bounds === null) return fail('Island adaptive planning has no finite bounds.');
  const xs = islandCuts(region, bounds, 'x'),
    ys = islandCuts(region, bounds, 'y');
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
  const lastIndex = sequences.length - 1;
  const last = sequences[lastIndex];
  if (last !== undefined)
    sequences[lastIndex] = {
      ...last,
      finishRings: [...last.finishRings, ...finish.map(toPolyline)],
    };
  return sequences.length === 0
    ? fail('Island adaptive planning found no reachable partitions.')
    : { ok: true, sequences, partitionCount };
}

function cellSequences(
  region: PathsD,
  bounds: Bounds,
  diameterMm: number,
  loadMm: number,
): IslandResult {
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

function fail(reason: string): IslandResult {
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
