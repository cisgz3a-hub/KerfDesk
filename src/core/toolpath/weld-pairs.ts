import type { Vec2 } from '../scene';
import {
  createWeldPairingState,
  replaceWeldPairAfterMerge,
  takeNextWeldPair,
  type WeldPairSelectorStats,
} from './weld-pairing-state';
import type { WeldPairChain, WeldPairSelection } from './weld-pair-selector';

/** Shared point-coincidence tolerance for weld joining and final closure. */
export const WELD_COINCIDENT_EPS = 1e-9;

/** Immutable chain accepted and returned by the internal weld-pairing stage. */
export type WeldWorkChain = WeldPairChain & {
  readonly points: ReadonlyArray<Vec2>;
  readonly order: number;
  readonly hasMerged: boolean;
};

/** Non-timing work counters returned by the internal weld-pairing stage. */
export type WeldPairingStats = WeldPairSelectorStats & {
  readonly strategy: 'persistent-heap';
};

/** Pure internal weld-pairing result. */
export type WeldPairingResult = {
  readonly chains: ReadonlyArray<WeldWorkChain>;
  readonly stats: WeldPairingStats;
};

type MergeResult = {
  readonly chains: ReadonlyArray<WeldWorkChain>;
  readonly survivor: WeldWorkChain;
};

/** Weld compatible chains without mutating caller-owned arrays or objects. */
export function weldPairs(
  chains: ReadonlyArray<WeldWorkChain>,
  maxGapPx: number,
  tangentSamplePx: number,
): WeldPairingResult {
  let activeChains: ReadonlyArray<WeldWorkChain> = chains.map(cloneChain);
  let state = createWeldPairingState(activeChains, maxGapPx, tangentSamplePx);
  for (;;) {
    const taken = takeNextWeldPair(state);
    state = taken.state;
    if (taken.candidate === null) return pairingResult(activeChains, state.stats);
    const merged = mergeSelectedChains(activeChains, taken.candidate);
    if (merged === null) continue;
    activeChains = merged.chains;
    state = replaceWeldPairAfterMerge(state, taken.candidate, merged.survivor);
  }
}

function mergeSelectedChains(
  chains: ReadonlyArray<WeldWorkChain>,
  selection: WeldPairSelection<WeldWorkChain>,
): MergeResult | null {
  if (!chains.includes(selection.a) || !chains.includes(selection.b)) return null;
  const aPoints =
    selection.aEnd === 'start' ? reversedPoints(selection.a.points) : [...selection.a.points];
  const bPoints =
    selection.bEnd === 'end' ? reversedPoints(selection.b.points) : [...selection.b.points];
  const tail = aPoints.at(-1);
  const head = bPoints[0];
  if (tail === undefined || head === undefined) return null;
  const isCoincident = Math.hypot(tail.x - head.x, tail.y - head.y) <= WELD_COINCIDENT_EPS;
  const survivor: WeldWorkChain = {
    points: [...aPoints, ...(isCoincident ? bPoints.slice(1) : bPoints)],
    order: Math.min(selection.a.order, selection.b.order),
    hasMerged: true,
  };
  return {
    chains: chains.flatMap((chain) => {
      if (chain === selection.a) return [survivor];
      return chain === selection.b ? [] : [chain];
    }),
    survivor,
  };
}

function reversedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return points.flatMap((_, index) => {
    const point = points.at(-index - 1);
    return point === undefined ? [] : [point];
  });
}

function cloneChain(chain: WeldWorkChain): WeldWorkChain {
  return {
    points: [...chain.points],
    order: chain.order,
    hasMerged: chain.hasMerged,
  };
}

function pairingResult(
  chains: ReadonlyArray<WeldWorkChain>,
  stats: WeldPairSelectorStats,
): WeldPairingResult {
  return { chains, stats: { ...stats, strategy: 'persistent-heap' } };
}
