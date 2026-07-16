// Stroke-chain assembly: turn the pruned skeleton graph into the final
// engraving polylines.
//   * Junction pairing — at every junction the incident chains are paired by
//     STRAIGHTEST CONTINUATION (angle closest to a through-line), so an X
//     crossing becomes two long strokes instead of four stubs.
//   * Tip extension — the skeleton stops one stroke-radius short of the true
//     ink tip; each open end is extended along its tangent through the ink.
//   * Smoothing + simplification — a light Laplacian pass (ends pinned)
//     removes the last of the pixel staircase, then Douglas-Peucker thins
//     the vertex count without moving the line visibly.

import type { Polyline, Vec2 } from '../../scene';
import { fairChainAlongArc } from './arc-fairing';
import { smoothChainCurvature } from './chain-smoothing';
import { refineChainForOutput } from './curve-refine';
import type { InkMask } from './distance-field';
import { bridgeNearbyEnds, pairThroughJunctions, type Chain } from './junction-pairing';
import { decideLoopClosure, LOOP_TOUCH_GAP_PX, type LoopClosureOptions } from './loop-closure';
import { pointAtArcDistance, radiusAtPosition } from './polyline-window';
import { repairJunctionSeams, weldBranchEnds } from './seam-repair';
import { sharpenChainBends } from './sharpen-bends';
import { arcLength } from './spur-pruning';
import type { StrokeGraph } from './stroke-graph';

export type ChainAssemblyOptions = {
  /** Bridge separate open ends closer than this many pixels. */
  readonly joinGapPx: number;
  /** When > 1, tangent-ALIGNED continuations may bridge and close loops from
   *  up to joinGapPx × this factor away (edge maps have detection dropouts
   *  much wider than their join knob). Default 1 = strict knob semantics. */
  readonly alignedJoinFactor?: number;
  /** Multiplier on the simplification epsilon — the TraceOptions
   *  lineTolerance contract (higher = fewer vertices). Default 1. */
  readonly simplifyTolerance?: number;
  /** When > 0, ANY open end stopping within this many pixels of another
   *  polyline welds onto it (approach-gated). Edge maps need this: Canny
   *  drops pixels wherever edges meet, so lines end a hair before the line
   *  they visibly join. Default 0 = junction-anchored welds only. */
  readonly weldOpenEndsPx?: number;
  /** Sub-pixel refinement applied to every raw chain vertex before
   *  smoothing (edge mode snaps onto the gradient ridge). */
  readonly snapPoint?: (p: Vec2) => Vec2;
};

const TANGENT_PROBE_PX = 3;
const SMOOTHING_PASSES = 2;
const SIMPLIFY_EPSILON_PX = 0.45;
const MIN_CHAIN_LENGTH_PX = 1.5;
const TIP_STEP_PX = 0.5;

export function assembleStrokePaths(
  graph: StrokeGraph,
  distSq: Float64Array,
  mask: InkMask,
  options: ChainAssemblyOptions,
): Polyline[] {
  const chains = prepareChains(graph, options.snapPoint);
  pairThroughJunctions(chains, graph);
  const alignedFactor = Math.max(1, options.alignedJoinFactor ?? 1);
  bridgeNearbyEnds(chains, options.joinGapPx, alignedFactor);
  const closure = closureOptionsFor(options.joinGapPx, alignedFactor);
  const junctions = graph.nodes.filter((n) => n.kind === 'junction').map((n) => n.pos);
  for (const chain of chains) {
    closeOrExtend(chain, junctions, distSq, mask, closure);
  }
  // Junction centroids dent every through-path (the medial axis genuinely
  // bends toward a T branch): rebuild those seams on ALL chains, then snap
  // branch endpoints back onto the straightened lines they branch from.
  for (const chain of chains) {
    if (!chain.alive) continue;
    chain.points = repairJunctionSeams(chain.points, chain.closed, junctions, distSq, mask.width);
  }
  weldBranchEnds(chains, junctions, Math.max(0, options.weldOpenEndsPx ?? 0));
  // Welds move endpoints; a ring whose ends both landed on the same target
  // may only NOW be closable.
  for (const chain of chains) {
    if (chain.alive && !chain.closed) applyLoopClosure(chain, closure);
  }
  const simplifyEpsilonPx = SIMPLIFY_EPSILON_PX * Math.max(0.1, options.simplifyTolerance ?? 1);
  return finalizeChains(chains, distSq, mask, simplifyEpsilonPx);
}

// Raw graph chains → snapped (edge mode) and staircase-smoothed chains.
function prepareChains(graph: StrokeGraph, snapPoint: ((p: Vec2) => Vec2) | undefined): Chain[] {
  const chains: Chain[] = graph.chains.map((c) => ({
    points: [...c.points],
    closed: c.closed,
    alive: true,
  }));
  if (snapPoint !== undefined) {
    for (const chain of chains) chain.points = chain.points.map(snapPoint);
  }
  for (const chain of chains) smoothChain(chain);
  return chains;
}

// Loop closure reach widens only in aligned mode; the strict default keeps
// the centerline contract (close only touching ring ends) unchanged.
function closureOptionsFor(joinGapPx: number, alignedFactor: number): LoopClosureOptions {
  if (alignedFactor <= 1) {
    return {
      touchGapPx: LOOP_TOUCH_GAP_PX,
      cornerGapPx: LOOP_TOUCH_GAP_PX,
      alignedGapPx: LOOP_TOUCH_GAP_PX,
    };
  }
  return {
    touchGapPx: LOOP_TOUCH_GAP_PX,
    cornerGapPx: Math.max(LOOP_TOUCH_GAP_PX, joinGapPx),
    alignedGapPx: Math.max(LOOP_TOUCH_GAP_PX, joinGapPx * alignedFactor),
  };
}

function applyLoopClosure(chain: Chain, closure: LoopClosureOptions): void {
  const decision = decideLoopClosure(chain.points, closure);
  if (decision.kind === 'open') return;
  if (decision.dropLastPoint) chain.points.pop();
  chain.closed = true;
}

function closeOrExtend(
  chain: Chain,
  junctions: ReadonlyArray<Vec2>,
  distSq: Float64Array,
  mask: InkMask,
  closure: LoopClosureOptions,
): void {
  if (!chain.alive || chain.closed) return;
  // Close cycles FIRST — a ring's two ends meet at a junction, and extending
  // them would walk 3 radii through the band in each direction (the "tail on
  // every ring" defect).
  applyLoopClosure(chain, closure);
  if (chain.closed) return;
  if (isTrueTip(chain, 'start', junctions, distSq, mask.width)) {
    extendTip(chain, 'start', distSq, mask);
  }
  if (isTrueTip(chain, 'end', junctions, distSq, mask.width)) {
    extendTip(chain, 'end', distSq, mask);
  }
}

function finalizeChains(
  chains: ReadonlyArray<Chain>,
  distSq: Float64Array,
  mask: InkMask,
  simplifyEpsilonPx: number,
): Polyline[] {
  const result: Polyline[] = [];
  for (const chain of chains) {
    if (!chain.alive) continue;
    if (chain.closed && isJunctionArtifactLoop(chain, distSq, mask.width)) continue;
    // Thinning chamfers drawn corners and round nibs round them; rebuild the
    // vertices before simplification eats the dense points the tangent
    // estimates need.
    const sharpened = sharpenChainBends(chain.points, chain.closed, distSq, mask.width);
    // Even out the residual pixel-scale curvature noise on the DENSE chain
    // (corners pinned) before Douglas-Peucker samples it — otherwise every
    // sampled vertex inherits a slightly-wrong tangent and the curve facets
    // (the angular-bowl defect). Corners stay exact objects for output pinning.
    const evened = smoothChainCurvature(sharpened.points, chain.closed, sharpened.corners);
    // The Taubin passes are blind to the multi-pixel lattice beat that reads
    // as wobble on smooth turns; the bounded arc-length quadratic fit removes
    // it before Douglas-Peucker can anchor vertices on its extremes.
    const faired = fairChainAlongArc(evened, chain.closed, sharpened.corners);
    const simplified = simplifyChain(faired, chain.closed, simplifyEpsilonPx);
    if (simplified.length < 2) continue;
    if (!chain.closed && arcLength(simplified) < MIN_CHAIN_LENGTH_PX) continue;
    result.push({
      // Bound the output resample to the same ε it was simplified with: the
      // spline may smooth within ε of each chord but must not bow past it into
      // empty paper (the serif-foot "smile" overshoot).
      points: refineChainForOutput(simplified, chain.closed, sharpened.corners, simplifyEpsilonPx),
      closed: chain.closed,
    });
  }
  return result;
}

// Thinning a FAT multi-stroke crossing can leave a tiny skeleton ring around
// the junction. A real drawn ring is much longer than the local stroke
// radius; a junction artifact is not — drop loops shorter than a few radii.
function isJunctionArtifactLoop(chain: Chain, distSq: Float64Array, width: number): boolean {
  const length = arcLength(chain.points) + closingSegmentLength(chain.points);
  let radiusSum = 0;
  let count = 0;
  for (const p of chain.points) {
    radiusSum += radiusAtPosition(p, distSq, width);
    count += 1;
  }
  const meanRadius = count === 0 ? 0 : radiusSum / count;
  return length < Math.max(6, 3 * meanRadius);
}

function closingSegmentLength(points: ReadonlyArray<Vec2>): number {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return 0;
  return Math.hypot(last.x - first.x, last.y - first.y);
}

// --- smoothing ---

// Taubin λ|μ smoothing: a shrink-free alternative to plain Laplacian
// passes. Laplacian smoothing contracts every closed loop toward its
// centroid — small letter bowls visibly "melt" (the LANGEBAAN defect) —
// while Taubin's negative μ pass re-inflates what the λ pass shrank,
// killing the pixel staircase without eroding feature area.
const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;

/** The same two shrink-free Taubin passes `prepareChains` applies to every
 *  raw dense chain before the corner/evening stages. Exported for the contour
 *  tracer, whose boundary chains need the identical pre-conditioning. */
export function smoothRawChain(points: ReadonlyArray<Vec2>, closed: boolean): Vec2[] {
  const chain: Chain = { points: [...points], closed, alive: true };
  smoothChain(chain);
  return chain.points;
}

function smoothChain(chain: Chain): void {
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    smoothingStep(chain, TAUBIN_LAMBDA);
    smoothingStep(chain, TAUBIN_MU);
  }
}

function smoothingStep(chain: Chain, factor: number): void {
  const src = chain.points;
  if (src.length < 3) return;
  const out: Vec2[] = new Array<Vec2>(src.length);
  for (let i = 0; i < src.length; i += 1) {
    const p = src[i];
    if (p === undefined) continue;
    const prev = chain.closed ? src[(i - 1 + src.length) % src.length] : src[i - 1];
    const next = chain.closed ? src[(i + 1) % src.length] : src[i + 1];
    if (prev === undefined || next === undefined) {
      out[i] = p; // pinned ends of open chains
      continue;
    }
    const midX = (prev.x + next.x) / 2;
    const midY = (prev.y + next.y) / 2;
    out[i] = { x: p.x + factor * (midX - p.x), y: p.y + factor * (midY - p.y) };
  }
  chain.points = out.filter((p): p is Vec2 => p !== undefined);
}

// --- tip extension ---

// A chain end that terminates AT a junction is not a stroke tip — it is an
// unpaired arm of a crossing and must not be extended into the ink.
function isTrueTip(
  chain: Chain,
  which: 'start' | 'end',
  junctions: ReadonlyArray<Vec2>,
  distSq: Float64Array,
  width: number,
): boolean {
  const tip = which === 'start' ? chain.points[0] : chain.points.at(-1);
  if (tip === undefined) return false;
  const guard = Math.max(1.5, 1.5 * radiusAtPosition(tip, distSq, width));
  for (const j of junctions) {
    if (Math.hypot(j.x - tip.x, j.y - tip.y) <= guard) return false;
  }
  return true;
}

// Extend an open end to the true ink tip by FOLLOWING the stroke, not by
// firing a straight ray — a straight ray exits the side of a curving stroke
// after a pixel or two. Each step picks the most forward-and-centred ink
// direction and the heading is refreshed, so the extension bends with the
// stroke — but every candidate stays hard-coned to the INITIAL tangent.
// Inside a round cap the distance field is radial (no restoring force), so
// an unanchored heading random-walks angularly and can veer 90° off-axis;
// the medial continuation through a cap is straight, so anchor to it.
function extendTip(
  chain: Chain,
  which: 'start' | 'end',
  distSq: Float64Array,
  mask: InkMask,
): void {
  const pts = chain.points;
  if (pts.length < 2) return;
  const fromStart = which === 'start';
  const tip = fromStart ? pts[0] : pts.at(-1);
  const anchor = pointAtArcDistance(pts, fromStart, TANGENT_PROBE_PX);
  if (tip === undefined || anchor === undefined) return;
  const dir0 = normalize(tip.x - anchor.x, tip.y - anchor.y);
  if (dir0 === null) return;
  const radius = radiusAtPosition(tip, distSq, mask.width);
  if (radius <= TIP_STEP_PX) return;
  const added = walkRidge(tip, dir0, radius, distSq, mask);
  if (added.length === 0) return;
  if (fromStart) pts.unshift(...added.reverse());
  else pts.push(...added);
}

function walkRidge(
  tip: Vec2,
  dir0: Vec2,
  radius: number,
  distSq: Float64Array,
  mask: InkMask,
): Vec2[] {
  const maxSteps = Math.ceil((radius * 3) / TIP_STEP_PX);
  const added: Vec2[] = [];
  let cur = tip;
  let dir = dir0;
  for (let step = 0; step < maxSteps; step += 1) {
    const next = bestForwardStep(cur, dir, dir0, distSq, mask);
    if (next === null) break;
    added.push(next);
    const stepped = normalize(next.x - cur.x, next.y - cur.y);
    if (stepped !== null) {
      dir = normalize(dir.x * 0.5 + stepped.x * 0.5, dir.y * 0.5 + stepped.y * 0.5) ?? dir;
    }
    cur = next;
  }
  return added;
}

const FORWARD_DIRECTIONS: ReadonlyArray<Vec2> = buildForwardDirections();

function buildForwardDirections(): Vec2[] {
  const dirs: Vec2[] = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * 2 * Math.PI;
    dirs.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return dirs;
}

// Total swing allowed relative to the initial tangent. ±40° follows any
// realistic stroke curvature across a cap-length walk while making a full
// off-axis veer geometrically impossible.
const COS_MAX_TIP_SWING = Math.cos((40 * Math.PI) / 180);

function bestForwardStep(
  cur: Vec2,
  dir: Vec2,
  dir0: Vec2,
  distSq: Float64Array,
  mask: InkMask,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (const d of FORWARD_DIRECTIONS) {
    const forward = d.x * dir.x + d.y * dir.y;
    if (forward < 0.5) continue; // ±60° of current heading — never double back
    const alignment = d.x * dir0.x + d.y * dir0.y;
    if (alignment < COS_MAX_TIP_SWING) continue; // hard cone around the tangent
    const candidate = { x: cur.x + d.x * TIP_STEP_PX, y: cur.y + d.y * TIP_STEP_PX };
    if (!isInk(candidate, mask)) continue;
    // Prefer straight continuation (current heading AND initial tangent — the
    // tangent term makes ties resolve straight instead of drifting), tie-broken
    // toward the distance ridge so the extension stays centred into the cap.
    const score = forward + alignment + radiusAtPosition(candidate, distSq, mask.width) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function normalize(x: number, y: number): Vec2 | null {
  const len = Math.hypot(x, y);
  return len < 1e-9 ? null : { x: x / len, y: y / len };
}

function isInk(p: Vec2, mask: InkMask): boolean {
  const x = Math.round(p.x - 0.5);
  const y = Math.round(p.y - 0.5);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return (mask.ink[y * mask.width + x] ?? 0) === 1;
}

// --- Douglas-Peucker simplification ---

/** Closed-aware Douglas-Peucker simplification (exported for the contour
 *  tracer, which finishes boundary chains with the same stage sequence). */
export function simplifyChain(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  epsilonPx: number,
): Vec2[] {
  if (points.length <= 2) return [...points];
  if (!closed) return douglasPeucker(points, epsilonPx);
  // Closed: anchor at 0 and the farthest point, simplify both halves.
  const anchor = farthestIndexFrom(points, 0);
  const half1 = douglasPeucker(points.slice(0, anchor + 1), epsilonPx);
  const half2 = douglasPeucker([...points.slice(anchor), points[0] as Vec2], epsilonPx);
  return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

function farthestIndexFrom(points: ReadonlyArray<Vec2>, from: number): number {
  const origin = points[from];
  if (origin === undefined) return points.length >> 1;
  let best = from;
  let bestD = -1;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return Math.max(1, best);
}

// Index of the point deviating most from segment lo→hi (beyond epsilon), or
// -1 when the whole range fits.
function worstDeviationIndex(
  points: ReadonlyArray<Vec2>,
  lo: number,
  hi: number,
  epsilon: number,
): number {
  const a = points[lo];
  const b = points[hi];
  if (a === undefined || b === undefined) return -1;
  let worst = -1;
  let worstD = epsilon;
  for (let i = lo + 1; i < hi; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    const d = pointToSegmentDistance(p, a, b);
    if (d > worstD) {
      worstD = d;
      worst = i;
    }
  }
  return worst;
}

function douglasPeucker(points: ReadonlyArray<Vec2>, epsilon: number): Vec2[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (range === undefined) break;
    const [lo, hi] = range;
    const worst = worstDeviationIndex(points, lo, hi, epsilon);
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if ((keep[i] ?? 0) === 1 && p !== undefined) out.push(p);
  }
  return out;
}

function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
