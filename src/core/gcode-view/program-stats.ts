// Program statistics derived from finished render-model segments
// (ADR-255 stage 2): bounds, per-kind distance totals, modal F/S ranges,
// and the plunge Z-level ladder for chapters and the depth lens.

import { SEG_KIND, SEG_MOTION, type AxisBounds, type ProgramStats } from './render-model-types';
import type { FinishedSegments } from './segment-builder';

const Z_LEVEL_ROUND = 1000; // 1 µm buckets

type Range = { min: number; max: number };

type StatsAccumulator = {
  readonly totals: number[];
  readonly motionBounds: BoundsAccumulator;
  readonly cutBounds: BoundsAccumulator;
  feed: Range | null;
  power: Range | null;
  readonly zLevels: Set<number>;
};

export function computeProgramStats(segments: FinishedSegments): ProgramStats {
  const acc: StatsAccumulator = {
    totals: [0, 0, 0, 0],
    motionBounds: createBoundsAccumulator(),
    cutBounds: createBoundsAccumulator(),
    feed: null,
    power: null,
    zLevels: new Set(),
  };
  for (let index = 0; index < segments.segmentCount; index += 1) {
    accumulateGeometry(acc, segments, index);
    accumulateRanges(acc, segments, index);
  }
  return finishStats(acc);
}

function finishStats(acc: StatsAccumulator): ProgramStats {
  return {
    motionBounds: acc.motionBounds.result(),
    cutBounds: acc.cutBounds.result(),
    ...kindTotals(acc.totals),
    ...rangeFields(acc.feed, acc.power),
    zLevels: [...acc.zLevels].sort((a, b) => b - a),
  };
}

function kindTotals(
  totals: ReadonlyArray<number>,
): Pick<ProgramStats, 'travelMm' | 'cutMm' | 'plungeMm' | 'retractMm'> {
  return {
    travelMm: totals[SEG_KIND.travel] ?? 0,
    cutMm: totals[SEG_KIND.cut] ?? 0,
    plungeMm: totals[SEG_KIND.plunge] ?? 0,
    retractMm: totals[SEG_KIND.retract] ?? 0,
  };
}

function rangeFields(
  feed: Range | null,
  power: Range | null,
): Pick<ProgramStats, 'feedMinMmPerMin' | 'feedMaxMmPerMin' | 'powerMin' | 'powerMax'> {
  return {
    feedMinMmPerMin: feed === null ? null : feed.min,
    feedMaxMmPerMin: feed === null ? null : feed.max,
    powerMin: power === null ? null : power.min,
    powerMax: power === null ? null : power.max,
  };
}

function accumulateGeometry(
  acc: StatsAccumulator,
  segments: FinishedSegments,
  index: number,
): void {
  const base = index * 6;
  const kind = segments.segKind[index] ?? SEG_KIND.travel;
  const previousRoute = index > 0 ? (segments.segRouteEndMm[index - 1] ?? 0) : 0;
  const length = (segments.segRouteEndMm[index] ?? 0) - previousRoute;
  acc.totals[kind] = (acc.totals[kind] ?? 0) + length;
  acc.motionBounds.include(segments.positions, base);
  if (kind === SEG_KIND.cut || kind === SEG_KIND.plunge) {
    acc.cutBounds.include(segments.positions, base);
  }
  if (kind === SEG_KIND.plunge) {
    acc.zLevels.add(
      Math.round((segments.positions[base + 5] ?? 0) * Z_LEVEL_ROUND) / Z_LEVEL_ROUND,
    );
  }
}

function accumulateRanges(acc: StatsAccumulator, segments: FinishedSegments, index: number): void {
  if ((segments.segMotion[index] ?? SEG_MOTION.rapid) === SEG_MOTION.rapid) return;
  acc.feed = extendRange(acc.feed, segments.segFeed[index] ?? 0);
  acc.power = extendRange(acc.power, segments.segPower[index] ?? 0);
}

function extendRange(range: Range | null, value: number): Range | null {
  if (value <= 0) return range;
  if (range === null) return { min: value, max: value };
  return { min: Math.min(range.min, value), max: Math.max(range.max, value) };
}

type BoundsAccumulator = {
  readonly include: (positions: Float32Array, base: number) => void;
  readonly result: () => AxisBounds | null;
};

function createBoundsAccumulator(): BoundsAccumulator {
  let any = false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const point = (x: number, y: number, z: number): void => {
    any = true;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  return {
    include: (positions, base) => {
      point(positions[base] ?? 0, positions[base + 1] ?? 0, positions[base + 2] ?? 0);
      point(positions[base + 3] ?? 0, positions[base + 4] ?? 0, positions[base + 5] ?? 0);
    },
    result: () => (any ? { minX, maxX, minY, maxY, minZ, maxZ } : null),
  };
}
