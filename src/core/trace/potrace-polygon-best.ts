import {
  buildPathState,
  mod,
  segmentPenaltyFromState,
  type PathState,
  type PotracePoint,
} from './potrace-polygon-core';
import { calculatePotraceLongestStraightSegments } from './potrace-polygon-longest';

type SegmentLimits = {
  readonly segment0: readonly number[];
  readonly segment1: readonly number[];
  readonly segmentCount: number;
};

export function calculateBestPotracePolygon(
  points: readonly PotracePoint[],
  longestStraightSegments = calculatePotraceLongestStraightSegments(points),
): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, index) => index);

  const clip0 = buildClip0(n, longestStraightSegments);
  const clip1 = buildClip1(n, clip0);
  const limits = buildSegmentLimits(n, clip0, clip1);
  const previous = fillPenaltyTable(buildPathState(points), limits, clip1);
  return backtrackPolygon(n, limits.segmentCount, previous);
}

function buildClip0(n: number, longestStraightSegments: readonly number[]): number[] {
  const clip0 = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let clip = mod((longestStraightSegments[mod(i - 1, n)] ?? 0) - 1, n);
    if (clip === i) clip = mod(i + 1, n);
    clip0[i] = clip < i ? n : clip;
  }
  return clip0;
}

function buildClip1(n: number, clip0: readonly number[]): number[] {
  const clip1 = new Array<number>(n + 1).fill(0);
  let j = 1;
  for (let i = 0; i < n; i += 1) {
    while (j <= (clip0[i] ?? 0)) {
      clip1[j] = i;
      j += 1;
    }
  }
  return clip1;
}

function buildSegmentLimits(
  n: number,
  clip0: readonly number[],
  clip1: readonly number[],
): SegmentLimits {
  const segment0 = new Array<number>(n + 1).fill(0);
  const segment1 = new Array<number>(n + 1).fill(0);
  let i = 0;
  let j = 0;

  for (j = 0; i < n; j += 1) {
    segment0[j] = i;
    i = clip0[i] ?? n;
  }
  segment0[j] = n;
  const segmentCount = j;

  i = n;
  for (j = segmentCount; j > 0; j -= 1) {
    segment1[j] = i;
    i = clip1[i] ?? 0;
  }
  segment1[0] = 0;
  return { segment0, segment1, segmentCount };
}

function fillPenaltyTable(
  state: PathState,
  limits: SegmentLimits,
  clip1: readonly number[],
): number[] {
  const penalty = new Array<number>(state.points.length + 1).fill(0);
  const previous = new Array<number>(state.points.length + 1).fill(0);

  for (let j = 1; j <= limits.segmentCount; j += 1) {
    fillPenaltySegment(state, limits, clip1, j, penalty, previous);
  }
  return previous;
}

function fillPenaltySegment(
  state: PathState,
  limits: SegmentLimits,
  clip1: readonly number[],
  j: number,
  penalty: number[],
  previous: number[],
): void {
  for (let i = limits.segment1[j] ?? 0; i <= (limits.segment0[j] ?? 0); i += 1) {
    const best = bestPredecessor(state, limits, clip1, j, i, penalty);
    previous[i] = best.index;
    penalty[i] = best.penalty;
  }
}

function bestPredecessor(
  state: PathState,
  limits: SegmentLimits,
  clip1: readonly number[],
  j: number,
  i: number,
  penalty: readonly number[],
): { index: number; penalty: number } {
  let bestIndex = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let k = limits.segment0[j - 1] ?? 0; k >= (clip1[i] ?? 0); k -= 1) {
    const currentPenalty = segmentPenaltyFromState(state, k, i) + (penalty[k] ?? 0);
    if (currentPenalty < bestPenalty) {
      bestIndex = k;
      bestPenalty = currentPenalty;
    }
  }
  return { index: bestIndex, penalty: bestPenalty };
}

function backtrackPolygon(n: number, segmentCount: number, previous: readonly number[]): number[] {
  const polygon = new Array<number>(segmentCount);
  let i = n;
  for (let j = segmentCount - 1; i > 0; j -= 1) {
    i = previous[i] ?? 0;
    polygon[j] = i;
  }
  return polygon;
}
