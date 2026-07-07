// Pure geometric predicates and builders for corner restoration — the
// detection half of sharpen-bends.ts (the chain-mutation orchestration
// lives there). Split out so each file stays within the file-size limit;
// nothing here mutates a chain or holds scan state.

import type { Vec2 } from '../../scene';
import { radiusAtPosition } from './polyline-window';

const QUICK_TANGENT_SPAN = 3;
const MIN_BEND_TURN_RAD = (40 * Math.PI) / 180;
const WINDOW_RADIUS_FACTOR = 1.5;
// Chamfer / round-nib join: vertex ≈ 0.41·r from the chain. Fillet of ≥ 2r:
// ≥ 0.83·r. The 0.65 cut keeps drawn fillets round.
export const MAX_VERTEX_OFFSET_FACTOR = 0.65;
// A vertex already ON the chain means the bend is already sharp — refiring
// would churn (and on closed chains, never converge).
const MIN_VERTEX_GAIN_PX = 0.35;
const MIN_WINDOW_RADIUS_PX = 2;
// Cap the window arm at stroke scale: inside blob-sized regions (shading
// binarized into big blobs) the local radius is tens of pixels, and an
// uncapped window replaces long real spans with chord pairs.
const MAX_WINDOW_ARM_PX = 12;
const PARALLEL_EPS = 1e-9;
// Max deviation of the leg (the window-length run leading into / out of the
// bend) from its own chord, as a fraction of the chord length.
const MAX_LEG_SAG_RATIO = 0.14;
const MIN_LEG_CHORD_PX = 1.5;
// Turn concentration: net tangent turn across the ±arm window divided by the
// net turn across the ±2·arm window. A corner concentrates its whole turn at
// the vertex (ratio → 1); an arc turns uniformly (ratio → 0.5). Chord-based
// tangents keep the measurement noise-robust.
const MIN_TURN_CONCENTRATION = 0.65;
const CONCENTRATION_WINDOW_FACTOR = 2;
// Chamfer→apex distance grows as 1/sin(apex half-angle): an acute tip's
// rebuilt vertex legitimately stands far off the chain (a 36° star tip needs
// ~1.3·r where a right angle needs 0.41·r — measured as blunted star tips,
// mean error 1.26px, before this scale). Normalised to 1 at a 90° turn so
// right-angle corners behave exactly as before; capped so a near-degenerate
// turn cannot extend without bound. The cap must clear a 36° star tip whose
// window radius floors at MIN_WINDOW_RADIUS_PX: reach needed ≈
// chamfer/sin(18°) ≈ 2.4× the right-angle bound.
const APEX_REACH_SCALE_MAX = 4;
// Tangent chords span this much arc length: a single sub-pixel segment's
// direction is dominated by residual boundary noise (measured on the
// jittered-bar instrument: noise bumps cleared the 40° turn gate and were
// rebuilt up to 2.3px off the edge), while a multi-point chord averages it
// away. legIsStraight has already verified the legs hug their chords.
const TANGENT_CHORD_PX = 3;

export type BendVertex = { readonly vertex: Vec2; readonly turnRad: number };

// Cheap gate: tangent turn across ±QUICK_TANGENT_SPAN points. Smoothing has
// already flattened the pixel staircase, so only real bends pass this.
export function quickTurnAt(pts: ReadonlyArray<Vec2>, i: number, closed: boolean): number {
  const n = pts.length;
  const beforeIdx = closed ? (i - QUICK_TANGENT_SPAN + n) % n : Math.max(0, i - QUICK_TANGENT_SPAN);
  const afterIdx = closed ? (i + QUICK_TANGENT_SPAN) % n : Math.min(n - 1, i + QUICK_TANGENT_SPAN);
  const before = pts[beforeIdx];
  const at = pts[i];
  const after = pts[afterIdx];
  if (!before || !at || !after) return 0;
  const inDir = unit(at.x - before.x, at.y - before.y);
  const outDir = unit(after.x - at.x, after.y - at.y);
  if (inDir === null || outDir === null) return 0;
  const dot = Math.max(-1, Math.min(1, inDir.x * outDir.x + inDir.y * outDir.y));
  return Math.acos(dot);
}

// Widening the window past a corner does not add turn; on an arc, turn
// accumulates uniformly, so the double window turns roughly twice as far.
export function turnIsConcentrated(pts: ReadonlyArray<Vec2>, i: number, arm: number): boolean {
  const near = netTurnAcross(pts, i, arm);
  const wide = netTurnAcross(pts, i, arm * CONCENTRATION_WINDOW_FACTOR);
  if (near === null || wide === null) return true; // window ran off the chain — no evidence either way
  if (wide < PARALLEL_EPS) return true;
  return near / wide >= MIN_TURN_CONCENTRATION;
}

// Net turn between the tangent entering and leaving a ±halfSpan window
// around index i. Tangents are short chords sampled just outside the window
// (same noise-averaging rationale as bendVertex's chord anchors).
export function netTurnAcross(pts: ReadonlyArray<Vec2>, i: number, halfSpan: number): number | null {
  const before = walkByArc(pts, i, -halfSpan);
  const after = walkByArc(pts, i, halfSpan);
  if (before === null || after === null) return null;
  const beforeFar = walkByArc(pts, before, -TANGENT_CHORD_PX);
  const afterFar = walkByArc(pts, after, TANGENT_CHORD_PX);
  if (beforeFar === null || afterFar === null) return null;
  const pIn1 = pts[beforeFar];
  const pIn2 = pts[before];
  const pOut1 = pts[after];
  const pOut2 = pts[afterFar];
  if (!pIn1 || !pIn2 || !pOut1 || !pOut2) return null;
  const inDir = unit(pIn2.x - pIn1.x, pIn2.y - pIn1.y);
  const outDir = unit(pOut2.x - pOut1.x, pOut2.y - pOut1.y);
  if (inDir === null || outDir === null) return null;
  const dot = Math.max(-1, Math.min(1, inDir.x * outDir.x + inDir.y * outDir.y));
  return Math.acos(dot);
}

// Index reached by walking |arc| of length from i in the sign's direction,
// or null when the chain ends first.
function walkByArc(pts: ReadonlyArray<Vec2>, i: number, arc: number): number | null {
  const step = arc < 0 ? -1 : 1;
  const target = Math.abs(arc);
  let cum = 0;
  let idx = i;
  while (cum < target) {
    const nextIdx = idx + step;
    if (nextIdx < 0 || nextIdx >= pts.length) return null;
    const a = pts[idx];
    const b = pts[nextIdx];
    if (a === undefined || b === undefined) return null;
    cum += Math.hypot(b.x - a.x, b.y - a.y);
    idx = nextIdx;
  }
  return idx;
}

// A drawn corner has STRAIGHT legs on both sides of the vertex; a small
// round bowl (letter counters, tiny loops) curves continuously and must
// stay round.
export function legIsStraight(
  pts: ReadonlyArray<Vec2>,
  bendIndex: number,
  arm: number,
  side: 'before' | 'after',
): boolean {
  const leg: Vec2[] = [];
  let cum = 0;
  const step = side === 'before' ? -1 : 1;
  for (let k = bendIndex + step; k > 0 && k < pts.length - 1 && cum <= arm; k += step) {
    const a = pts[k];
    const b = pts[k - step];
    if (a === undefined || b === undefined) break;
    cum += Math.hypot(a.x - b.x, a.y - b.y);
    leg.push(a);
  }
  if (leg.length < 3) return true; // too short to measure curvature
  const first = leg[0];
  const last = leg[leg.length - 1];
  if (first === undefined || last === undefined) return true;
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  if (chord < MIN_LEG_CHORD_PX) return false; // leg loops back — not a corner
  let sag = 0;
  for (const q of leg) sag = Math.max(sag, pointToSegment(q, first, last));
  return sag <= chord * MAX_LEG_SAG_RATIO;
}

export function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < PARALLEL_EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function arcLengthOf(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

// Window arm length for a bend: 1.5× the LARGEST stroke radius within the
// initial (point-local) window. Sized from the max radius near the bend, not
// the pinched radius at the bend point itself.
export function bendWindow(
  pts: ReadonlyArray<Vec2>,
  i: number,
  distSq: Float64Array,
  width: number,
): { readonly arm: number; readonly maxRadius: number } {
  const p = pts[i];
  const localRadius = p === undefined ? 0 : radiusAtPosition(p, distSq, width);
  const reach = Math.max(MIN_WINDOW_RADIUS_PX, localRadius) * WINDOW_RADIUS_FACTOR;
  let maxRadius = Math.max(MIN_WINDOW_RADIUS_PX, localRadius);
  for (const dir of [-1, 1]) {
    let cum = 0;
    for (let k = i; k > 0 && k < pts.length - 1 && cum <= reach; k += dir) {
      const a = pts[k];
      const b = pts[k + dir];
      if (a === undefined || b === undefined) break;
      cum += Math.hypot(b.x - a.x, b.y - a.y);
      maxRadius = Math.max(maxRadius, radiusAtPosition(b, distSq, width));
    }
  }
  return { arm: Math.min(maxRadius * WINDOW_RADIUS_FACTOR, MAX_WINDOW_ARM_PX), maxRadius };
}

// Intersect the head's exit tangent with the tail's entry tangent. Null for
// gentle bends, near-parallel tangents, or a vertex behind either arm.
export function bendVertex(head: ReadonlyArray<Vec2>, tail: ReadonlyArray<Vec2>): BendVertex | null {
  const a1 = chordAnchor(head, 'tail');
  const a2 = head.at(-1);
  const b1 = tail[0];
  const b2 = chordAnchor(tail, 'head');
  if (!a1 || !a2 || !b1 || !b2) return null;
  const dirA = unit(a2.x - a1.x, a2.y - a1.y);
  const dirB = unit(b2.x - b1.x, b2.y - b1.y);
  if (dirA === null || dirB === null) return null;
  const dot = Math.max(-1, Math.min(1, dirA.x * dirB.x + dirA.y * dirB.y));
  const turnRad = Math.acos(dot);
  if (turnRad < MIN_BEND_TURN_RAD) return null;
  const denom = dirA.x * dirB.y - dirA.y * dirB.x;
  if (Math.abs(denom) < PARALLEL_EPS) return null;
  const wx = b1.x - a2.x;
  const wy = b1.y - a2.y;
  const t = (wx * dirB.y - wy * dirB.x) / denom; // along dirA from a2
  const s = (wx * dirA.y - wy * dirA.x) / denom; // along dirB from b1
  if (t < 0 || s > 0) return null; // vertex must lie ahead of head, behind tail
  return { vertex: { x: a2.x + dirA.x * t, y: a2.y + dirA.y * t }, turnRad };
}

export function apexReachScale(turnRad: number): number {
  const apexHalf = Math.max((Math.PI - turnRad) / 2, 1e-3);
  return Math.min(APEX_REACH_SCALE_MAX, Math.SQRT1_2 / Math.sin(apexHalf));
}

// A chamfer hugs its rebuilt vertex; a genuine arc's tangent intersection
// stands well off the curve. The lower bound rejects bends that are ALREADY
// sharp (vertex on the chain) so sharpening is idempotent; the upper bound
// is the angle-scaled offset the caller computed.
export function vertexHugsChain(
  vertex: Vec2,
  pts: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  maxOffsetPx: number,
): boolean {
  let nearest = Infinity;
  for (let k = Math.max(0, from - 1); k <= Math.min(pts.length - 1, to); k += 1) {
    const p = pts[k];
    if (p === undefined) continue;
    nearest = Math.min(nearest, Math.hypot(p.x - vertex.x, p.y - vertex.y));
  }
  return nearest >= MIN_VERTEX_GAIN_PX && nearest <= maxOffsetPx;
}

// The far end of a tangent chord: walk from the head's last point (or the
// tail's first) until TANGENT_CHORD_PX of arc length is behind the anchor.
function chordAnchor(points: ReadonlyArray<Vec2>, from: 'head' | 'tail'): Vec2 | undefined {
  const n = points.length;
  if (n < 2) return undefined;
  const startIdx = from === 'tail' ? n - 1 : 0;
  const step = from === 'tail' ? -1 : 1;
  let cum = 0;
  let idx = startIdx;
  while (idx + step >= 0 && idx + step < n && cum < TANGENT_CHORD_PX) {
    const a = points[idx];
    const b = points[idx + step];
    if (a === undefined || b === undefined) break;
    cum += Math.hypot(b.x - a.x, b.y - a.y);
    idx += step;
  }
  return points[idx];
}

function unit(x: number, y: number): Vec2 | null {
  const len = Math.hypot(x, y);
  return len < PARALLEL_EPS ? null : { x: x / len, y: y / len };
}
