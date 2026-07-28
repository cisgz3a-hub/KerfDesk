import type { Vec2 } from '../scene';
import {
  describeWeldChainContinuity,
  isWeldEndpointDescriptorContinuous,
  type WeldChainContinuityDescriptors,
  type WeldPolylineEnd,
} from './is-weld-endpoint-continuous';

export type { WeldPolylineEnd } from './is-weld-endpoint-continuous';

const POLYLINE_ENDS: ReadonlyArray<WeldPolylineEnd> = ['start', 'end'];

/** Chain shape consumed by the internal weld-pair selector. */
export type WeldPairChain = {
  readonly points: ReadonlyArray<Vec2>;
  readonly order: number;
};

/** Exact endpoint match selected for one unordered pair of active chains. */
export type WeldEndpointMatch = {
  readonly aEnd: WeldPolylineEnd;
  readonly bEnd: WeldPolylineEnd;
  readonly dist: number;
};

/** Active chain pair returned by the internal deterministic selector. */
export type WeldPairSelection<Chain extends WeldPairChain = WeldPairChain> = WeldEndpointMatch & {
  readonly a: Chain;
  readonly b: Chain;
};

/** One immutable active-chain version and its precomputed continuity descriptor. */
export type WeldRankedChain<Chain extends WeldPairChain> = {
  readonly chain: Chain;
  readonly rank: number;
  readonly version: number;
  readonly continuity: WeldChainContinuityDescriptors;
};

/** Heap candidate with enough identity to reject stale chain versions in constant time. */
export type WeldPairCandidate<Chain extends WeldPairChain> = WeldPairSelection<Chain> & {
  readonly aRank: number;
  readonly bRank: number;
  readonly aVersion: number;
  readonly bVersion: number;
};

type DescriptorMatchInput = {
  readonly a: WeldChainContinuityDescriptors;
  readonly b: WeldChainContinuityDescriptors;
  readonly maxGapPx: number;
};

/** Choose the legacy-order best endpoint combination for one chain pair. */
export function bestWeldEndpointMatch(
  a: WeldPairChain,
  b: WeldPairChain,
  maxGapPx: number,
  tangentSamplePx: number,
): WeldEndpointMatch | null {
  return bestWeldEndpointDescriptorMatch({
    a: describeWeldChainContinuity(a.points, tangentSamplePx).descriptors,
    b: describeWeldChainContinuity(b.points, tangentSamplePx).descriptors,
    maxGapPx,
  });
}

/** Choose the legacy-order best match from immutable endpoint descriptors. */
export function bestWeldEndpointDescriptorMatch(
  input: DescriptorMatchInput,
): WeldEndpointMatch | null {
  let best: WeldEndpointMatch | null = null;
  for (const aEnd of POLYLINE_ENDS) {
    for (const bEnd of POLYLINE_ENDS) {
      const match = descriptorMatch(input, aEnd, bEnd);
      if (match !== null && (best === null || match.dist < best.dist)) best = match;
    }
  }
  return best;
}

/** Build one exact candidate from two current ranked chain versions. */
export function createWeldPairCandidate<Chain extends WeldPairChain>(
  first: WeldRankedChain<Chain>,
  second: WeldRankedChain<Chain>,
  maxGapPx: number,
): WeldPairCandidate<Chain> | null {
  const a = first.rank < second.rank ? first : second;
  const b = first.rank < second.rank ? second : first;
  const match = bestWeldEndpointDescriptorMatch({
    a: a.continuity,
    b: b.continuity,
    maxGapPx,
  });
  return match === null
    ? null
    : {
        a: a.chain,
        b: b.chain,
        ...match,
        aRank: a.rank,
        bRank: b.rank,
        aVersion: a.version,
        bVersion: b.version,
      };
}

/** Total legacy-compatible ordering for persistent candidate-heap nodes. */
export function isWeldPairCandidateBefore<Chain extends WeldPairChain>(
  left: WeldPairCandidate<Chain>,
  right: WeldPairCandidate<Chain>,
): boolean {
  if (left.dist !== right.dist) return left.dist < right.dist;
  if (left.aRank !== right.aRank) return left.aRank < right.aRank;
  if (left.bRank !== right.bRank) return left.bRank < right.bRank;
  if (left.aEnd !== right.aEnd) return left.aEnd === 'start';
  if (left.bEnd !== right.bEnd) return left.bEnd === 'start';
  if (left.aVersion !== right.aVersion) return left.aVersion < right.aVersion;
  return left.bVersion < right.bVersion;
}

function descriptorMatch(
  input: DescriptorMatchInput,
  aEnd: WeldPolylineEnd,
  bEnd: WeldPolylineEnd,
): WeldEndpointMatch | null {
  const a = input.a[aEnd];
  const b = input.b[bEnd];
  if (a === null || b === null) return null;
  const dist = Math.hypot(a.anchor.x - b.anchor.x, a.anchor.y - b.anchor.y);
  if (dist > input.maxGapPx) return null;
  return isWeldEndpointDescriptorContinuous({ a, b }) ? { aEnd, bEnd, dist } : null;
}
