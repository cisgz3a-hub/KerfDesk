import type { Vec2 } from '../core/scene';
import {
  referenceBestWeldEndpointMatch,
  type ReferenceWeldEndpointMatch,
  type ReferenceWeldPolylineEnd,
} from './reference-weld-continuity';
import type { WeldWorkChain } from '../core/toolpath/weld-pairs';

const RING_CENTER_PX = 250;
const RING_RADIUS_PX = 200;
const RING_FRAGMENT_COUNT = 4;
const RING_POINTS_PER_FRAGMENT = 40;
const RING_SEAM_OFFSET_RAD = 0.01;
const QUARTER_TURN_RAD = Math.PI / 2;
const DENSE_FRAGMENT_PITCH_PX = 0.01;
const DENSE_FRAGMENT_LENGTH_PX = 0.001;
const REFERENCE_WELD_COINCIDENT_EPS = 1e-9;
const STALE_FRAGMENT_X_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [3, 2],
  [4, 5],
];

type ReferenceSelection = ReferenceWeldEndpointMatch & {
  readonly i: number;
  readonly j: number;
};

/** Coordinates and stable rank for one two-point weld fixture. */
export type WeldPairSegmentInput = {
  readonly order: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

/** Build one immutable two-point open work chain. */
export function weldPairSegment(input: WeldPairSegmentInput): WeldWorkChain {
  return {
    order: input.order,
    hasMerged: false,
    points: [
      { x: input.x0, y: input.y0 },
      { x: input.x1, y: input.y1 },
    ],
  };
}

/** Clone a work chain deeply enough to prove caller immutability. */
export function cloneWeldWorkChain(chain: WeldWorkChain): WeldWorkChain {
  return {
    order: chain.order,
    hasMerged: chain.hasMerged,
    points: chain.points.map((point) => ({ ...point })),
  };
}

/** Run the frozen exhaustive nearest-pair contract as a differential oracle. */
export function referenceWeldPairs(
  input: ReadonlyArray<WeldWorkChain>,
  maxGapPx: number,
  tangentSamplePx: number,
): ReadonlyArray<WeldWorkChain> {
  let chains = input.map(cloneWeldWorkChain);
  for (;;) {
    const selection = referenceBestPair(chains, maxGapPx, tangentSamplePx);
    if (selection === null) return chains;
    const merged = referenceMerge(chains, selection);
    if (merged === null) return chains;
    chains = merged;
  }
}

/** Build the four translated circle fragments that exercise heap bubbling. */
export function translatedRingWeldChains(): WeldWorkChain[] {
  return Array.from({ length: RING_FRAGMENT_COUNT }, (_, fragmentIndex) => {
    const start = fragmentIndex * QUARTER_TURN_RAD + RING_SEAM_OFFSET_RAD;
    const end = (fragmentIndex + 1) * QUARTER_TURN_RAD - RING_SEAM_OFFSET_RAD;
    const points = Array.from({ length: RING_POINTS_PER_FRAGMENT + 1 }, (_, pointIndex) => {
      const theta = start + ((end - start) * pointIndex) / RING_POINTS_PER_FRAGMENT;
      return {
        x: RING_CENTER_PX + RING_RADIUS_PX * Math.cos(theta),
        y: RING_CENTER_PX + RING_RADIUS_PX * Math.sin(theta),
      };
    });
    return { points, order: fragmentIndex, hasMerged: false };
  });
}

/** Build equal-gap fragments whose old candidates become stale after a merge. */
export function staleCandidateWeldChains(): WeldWorkChain[] {
  return STALE_FRAGMENT_X_RANGES.map(([startX, endX], order) =>
    weldPairSegment({ order, x0: startX, y0: 0, x1: endX, y1: 0 }),
  );
}

/** Build a fully dense set used for non-timing candidate-work assertions. */
export function denseWeldChains(count: number): WeldWorkChain[] {
  return Array.from({ length: count }, (_, order) => {
    const startX = order * DENSE_FRAGMENT_PITCH_PX;
    return weldPairSegment({
      order,
      x0: startX,
      y0: 0,
      x1: startX + DENSE_FRAGMENT_LENGTH_PX,
      y1: 0,
    });
  });
}

function referenceBestPair(
  chains: ReadonlyArray<WeldWorkChain>,
  maxGapPx: number,
  tangentSamplePx: number,
): ReferenceSelection | null {
  let best: ReferenceSelection | null = null;
  for (let i = 0; i < chains.length; i += 1) {
    for (let j = i + 1; j < chains.length; j += 1) {
      const a = chains[i];
      const b = chains[j];
      if (a === undefined || b === undefined) continue;
      const match = referenceBestWeldEndpointMatch(a.points, b.points, maxGapPx, tangentSamplePx);
      if (match !== null && (best === null || match.dist < best.dist)) {
        best = { i, j, ...match };
      }
    }
  }
  return best;
}

function referenceMerge(
  chains: ReadonlyArray<WeldWorkChain>,
  selection: ReferenceSelection,
): WeldWorkChain[] | null {
  const a = chains[selection.i];
  const b = chains[selection.j];
  if (a === undefined || b === undefined) return null;
  const aPoints = orientForJoin(a.points, selection.aEnd, 'end');
  const bPoints = orientForJoin(b.points, selection.bEnd, 'start');
  const tail = aPoints.at(-1);
  const head = bPoints[0];
  if (tail === undefined || head === undefined) return null;
  const isCoincident =
    Math.hypot(tail.x - head.x, tail.y - head.y) <= REFERENCE_WELD_COINCIDENT_EPS;
  const survivor: WeldWorkChain = {
    order: Math.min(a.order, b.order),
    hasMerged: true,
    points: [...aPoints, ...(isCoincident ? bPoints.slice(1) : bPoints)],
  };
  return chains.flatMap((chain, index) => {
    if (index === selection.i) return [survivor];
    return index === selection.j ? [] : [chain];
  });
}

function orientForJoin(
  points: ReadonlyArray<Vec2>,
  selectedEnd: ReferenceWeldPolylineEnd,
  targetEnd: ReferenceWeldPolylineEnd,
): Vec2[] {
  const oriented = points.map((point) => ({ ...point }));
  return selectedEnd === targetEnd
    ? oriented
    : oriented.flatMap((_, index) => {
        const point = oriented.at(-index - 1);
        return point === undefined ? [] : [point];
      });
}
