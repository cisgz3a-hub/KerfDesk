// Junction pairing and gap bridging. At every junction the incident chain
// ends are paired by STRAIGHTEST CONTINUATION (angle closest to a through-
// line), so an X crossing becomes two long strokes instead of four stubs;
// afterwards any two loose open ends closer than the join gap are bridged.

import type { Vec2 } from '../../scene';
import { pointAtArcDistance } from './polyline-window';
import type { StrokeGraph } from './stroke-graph';

/** A chain being assembled: mutable point list + liveness. */
export type Chain = {
  points: Vec2[];
  closed: boolean;
  alive: boolean;
};

const MIN_THROUGH_ANGLE_RAD = (110 * Math.PI) / 180;
const TANGENT_PROBE_PX = 3;
const POINT_MATCH_EPS = 1e-6;

type ChainEnd = { readonly chain: Chain; readonly atStart: boolean };

export function pairThroughJunctions(chains: Chain[], graph: StrokeGraph): void {
  for (const node of graph.nodes) {
    if (node.kind !== 'junction') continue;
    let ends = endsAtPoint(chains, node.pos);
    while (ends.length >= 2) {
      const pair = straightestPair(ends);
      if (pair === null) break;
      mergeEnds(pair[0], pair[1]);
      ends = endsAtPoint(chains, node.pos);
    }
  }
}

/** Bridge loose open ends. Any two ends closer than `joinGapPx` merge; when
 *  `alignedFactor` > 1, ends whose tangents CONTINUE each other across the
 *  bridge (both within ~35° of the bridge direction) may merge from up to
 *  `joinGapPx × alignedFactor` away — an aligned continuation is almost
 *  always the same drawn line interrupted by detection dropout, while a
 *  perpendicular weld almost never is. */
export function bridgeNearbyEnds(chains: Chain[], joinGapPx: number, alignedFactor = 1): void {
  if (joinGapPx <= 0) return;
  for (;;) {
    const pair = nearestBridgeableEnds(chains, joinGapPx, alignedFactor);
    if (pair === null) return;
    mergeEnds(pair[0], pair[1]);
  }
}

function endsAtPoint(chains: ReadonlyArray<Chain>, pos: Vec2): ChainEnd[] {
  const ends: ChainEnd[] = [];
  for (const chain of chains) {
    if (!chain.alive || chain.closed) continue;
    const first = chain.points[0];
    const last = chain.points.at(-1);
    if (first !== undefined && samePoint(first, pos)) ends.push({ chain, atStart: true });
    if (last !== undefined && samePoint(last, pos)) ends.push({ chain, atStart: false });
  }
  return ends;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < POINT_MATCH_EPS && Math.abs(a.y - b.y) < POINT_MATCH_EPS;
}

function straightestPair(ends: ReadonlyArray<ChainEnd>): readonly [ChainEnd, ChainEnd] | null {
  let best: readonly [ChainEnd, ChainEnd] | null = null;
  let bestAngle = MIN_THROUGH_ANGLE_RAD;
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i];
      const b = ends[j];
      if (a === undefined || b === undefined || a.chain === b.chain) continue;
      const angle = angleBetween(outgoingTangent(a), outgoingTangent(b));
      if (angle > bestAngle) {
        bestAngle = angle;
        best = [a, b];
      }
    }
  }
  return best;
}

// Tangent pointing AWAY from the junction into the chain.
function outgoingTangent(end: ChainEnd): Vec2 {
  const pts = end.chain.points;
  const anchor = end.atStart ? pts[0] : pts.at(-1);
  const probe = pointAtArcDistance(pts, end.atStart, TANGENT_PROBE_PX);
  if (anchor === undefined || probe === undefined) return { x: 1, y: 0 };
  const dx = probe.x - anchor.x;
  const dy = probe.y - anchor.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

// Angle between two outgoing tangents; π means a perfect through-line.
function angleBetween(a: Vec2, b: Vec2): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return Math.acos(dot);
}

function mergeEnds(a: ChainEnd, b: ChainEnd): void {
  // Orient chain A to END at the junction and chain B to START at it.
  if (a.atStart) a.chain.points.reverse();
  if (!b.atStart) b.chain.points.reverse();
  a.chain.points.push(...b.chain.points.slice(1));
  b.chain.alive = false;
  b.chain.points = [];
}

const MIN_BRIDGE_ALIGNMENT = Math.cos((35 * Math.PI) / 180);
// Within the join gap the bridge is lenient, but ends whose tangents clearly
// RECEDE from each other (summed forwardness below this) are two separate
// stroke tips that merely end near each other — welding them draws a
// doubled-back hairpin (adjacent glyph terminals in small traced text).
const MIN_BRIDGE_FORWARDNESS_SUM = -0.25;

function nearestBridgeableEnds(
  chains: ReadonlyArray<Chain>,
  joinGapPx: number,
  alignedFactor: number,
): readonly [ChainEnd, ChainEnd] | null {
  const ends = collectOpenEnds(chains);
  let best: readonly [ChainEnd, ChainEnd] | null = null;
  let bestDist = joinGapPx * Math.max(1, alignedFactor);
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const a = ends[i];
      const b = ends[j];
      if (a === undefined || b === undefined) continue;
      const d = endGap(a, b);
      if (d === null || d >= bestDist) continue;
      const forward = bridgeForwardness(a, b);
      if (forward === null) continue;
      if (d >= joinGapPx && !continuesBoth(forward)) continue;
      if (forward.aForward + forward.bForward < MIN_BRIDGE_FORWARDNESS_SUM) continue;
      bestDist = d;
      best = [a, b];
    }
  }
  return best;
}

function collectOpenEnds(chains: ReadonlyArray<Chain>): ChainEnd[] {
  const ends: ChainEnd[] = [];
  for (const chain of chains) {
    if (!chain.alive || chain.closed || chain.points.length < 2) continue;
    ends.push({ chain, atStart: true }, { chain, atStart: false });
  }
  return ends;
}

function endGap(a: ChainEnd, b: ChainEnd): number | null {
  if (a.chain === b.chain) return null;
  const pa = endPoint(a);
  const pb = endPoint(b);
  if (pa === undefined || pb === undefined) return null;
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

function endPoint(end: ChainEnd): Vec2 | undefined {
  return end.atStart ? end.chain.points[0] : end.chain.points.at(-1);
}

// How well the bridge segment continues each chain's direction of travel:
// each end's outward continuation (the reverse of its into-chain tangent)
// dotted with the bridge direction toward the other end. 1 = perfect
// continuation, -1 = pointing straight away.
function bridgeForwardness(
  a: ChainEnd,
  b: ChainEnd,
): { readonly aForward: number; readonly bForward: number } | null {
  const pa = endPoint(a);
  const pb = endPoint(b);
  if (pa === undefined || pb === undefined) return null;
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  if (len < POINT_MATCH_EPS) return { aForward: 1, bForward: 1 };
  const bridge = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len };
  const ta = outgoingTangent(a); // points INTO chain a
  const tb = outgoingTangent(b);
  return {
    aForward: -(ta.x * bridge.x + ta.y * bridge.y),
    bForward: tb.x * bridge.x + tb.y * bridge.y,
  };
}

function continuesBoth(forward: { readonly aForward: number; readonly bForward: number }): boolean {
  return forward.aForward >= MIN_BRIDGE_ALIGNMENT && forward.bForward >= MIN_BRIDGE_ALIGNMENT;
}
