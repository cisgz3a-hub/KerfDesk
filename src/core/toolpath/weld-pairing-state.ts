import { describeWeldChainContinuity } from './is-weld-endpoint-continuous';
import {
  popWeldCandidateHeap,
  pushWeldCandidateHeap,
  type WeldCandidateHeap,
} from './weld-candidate-heap';
import {
  createWeldPairCandidate,
  isWeldPairCandidateBefore,
  type WeldPairCandidate,
  type WeldPairChain,
  type WeldRankedChain,
} from './weld-pair-selector';

const ENDPOINT_COMBINATIONS_PER_PAIR = 4;

/** Non-timing work counters for persistent weld-pair selection. */
export type WeldPairSelectorStats = {
  readonly pairEvaluations: number;
  readonly endpointEvaluations: number;
  readonly heapPushes: number;
  readonly heapPops: number;
  readonly continuityDescriptorBuilds: number;
  readonly tangentPointVisits: number;
};

/** Immutable state for the persistent weld-pair selector. */
export type WeldPairingState<Chain extends WeldPairChain> = {
  readonly activeByRank: ReadonlyArray<WeldRankedChain<Chain> | null>;
  readonly heap: WeldCandidateHeap<WeldPairCandidate<Chain>>;
  readonly maxGapPx: number;
  readonly tangentSamplePx: number;
  readonly nextVersion: number;
  readonly stats: WeldPairSelectorStats;
};

/** One immutable selector step and its selected candidate, when one remains. */
export type WeldPairingTake<Chain extends WeldPairChain> = {
  readonly candidate: WeldPairCandidate<Chain> | null;
  readonly state: WeldPairingState<Chain>;
};

/** Build exact candidates for every initial unordered pair. */
export function createWeldPairingState<Chain extends WeldPairChain>(
  chains: ReadonlyArray<Chain>,
  maxGapPx: number,
  tangentSamplePx: number,
): WeldPairingState<Chain> {
  const builds = chains.map((chain, rank) => {
    const build = describeWeldChainContinuity(chain.points, tangentSamplePx);
    return {
      ranked: { chain, rank, version: rank, continuity: build.descriptors },
      tangentPointVisits: build.tangentPointVisits,
    };
  });
  let state: WeldPairingState<Chain> = {
    activeByRank: builds.map(({ ranked }) => ranked),
    heap: null,
    maxGapPx,
    tangentSamplePx,
    nextVersion: builds.length,
    stats: {
      pairEvaluations: 0,
      endpointEvaluations: 0,
      heapPushes: 0,
      heapPops: 0,
      continuityDescriptorBuilds: builds.length,
      tangentPointVisits: builds.reduce((sum, build) => sum + build.tangentPointVisits, 0),
    },
  };
  for (let aRank = 0; aRank < builds.length; aRank += 1) {
    for (let bRank = aRank + 1; bRank < builds.length; bRank += 1) {
      const a = state.activeByRank[aRank];
      const b = state.activeByRank[bRank];
      if (a !== null && a !== undefined && b !== null && b !== undefined) {
        state = queueCandidate(state, a, b);
      }
    }
  }
  return state;
}

/** Pop stale candidates until the next active pair or an empty heap is reached. */
export function takeNextWeldPair<Chain extends WeldPairChain>(
  state: WeldPairingState<Chain>,
): WeldPairingTake<Chain> {
  let heap = state.heap;
  let heapPops = 0;
  for (;;) {
    const popped = popWeldCandidateHeap(heap, isWeldPairCandidateBefore);
    if (popped === null) return pairingTake(state, heap, heapPops, null);
    heap = popped.heap;
    heapPops += 1;
    if (isCandidateActive(state.activeByRank, popped.value)) {
      return pairingTake(state, heap, heapPops, popped.value);
    }
  }
}

/** Replace the selected chain versions and queue only the new survivor pairs. */
export function replaceWeldPairAfterMerge<Chain extends WeldPairChain>(
  state: WeldPairingState<Chain>,
  selected: WeldPairCandidate<Chain>,
  survivor: Chain,
): WeldPairingState<Chain> {
  const build = describeWeldChainContinuity(survivor.points, state.tangentSamplePx);
  const ranked: WeldRankedChain<Chain> = {
    chain: survivor,
    rank: selected.aRank,
    version: state.nextVersion,
    continuity: build.descriptors,
  };
  const activeByRank = state.activeByRank.map((chain, rank) => {
    if (rank === selected.aRank) return ranked;
    return rank === selected.bRank ? null : chain;
  });
  let next: WeldPairingState<Chain> = {
    ...state,
    activeByRank,
    nextVersion: state.nextVersion + 1,
    stats: {
      ...state.stats,
      continuityDescriptorBuilds: state.stats.continuityDescriptorBuilds + 1,
      tangentPointVisits: state.stats.tangentPointVisits + build.tangentPointVisits,
    },
  };
  for (const other of activeByRank) {
    if (other !== null && other !== ranked) next = queueCandidate(next, ranked, other);
  }
  return next;
}

function queueCandidate<Chain extends WeldPairChain>(
  state: WeldPairingState<Chain>,
  first: WeldRankedChain<Chain>,
  second: WeldRankedChain<Chain>,
): WeldPairingState<Chain> {
  const candidate = createWeldPairCandidate(first, second, state.maxGapPx);
  const stats = {
    ...state.stats,
    pairEvaluations: state.stats.pairEvaluations + 1,
    endpointEvaluations: state.stats.endpointEvaluations + ENDPOINT_COMBINATIONS_PER_PAIR,
    heapPushes: state.stats.heapPushes + (candidate === null ? 0 : 1),
  };
  return candidate === null
    ? { ...state, stats }
    : {
        ...state,
        heap: pushWeldCandidateHeap(state.heap, candidate, isWeldPairCandidateBefore),
        stats,
      };
}

function isCandidateActive<Chain extends WeldPairChain>(
  activeByRank: ReadonlyArray<WeldRankedChain<Chain> | null>,
  candidate: WeldPairCandidate<Chain>,
): boolean {
  return (
    activeByRank[candidate.aRank]?.version === candidate.aVersion &&
    activeByRank[candidate.bRank]?.version === candidate.bVersion
  );
}

function pairingTake<Chain extends WeldPairChain>(
  state: WeldPairingState<Chain>,
  heap: WeldCandidateHeap<WeldPairCandidate<Chain>>,
  heapPops: number,
  candidate: WeldPairCandidate<Chain> | null,
): WeldPairingTake<Chain> {
  return {
    candidate,
    state: {
      ...state,
      heap,
      stats: { ...state.stats, heapPops: state.stats.heapPops + heapPops },
    },
  };
}
