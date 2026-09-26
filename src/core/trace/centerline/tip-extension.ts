// Tip extension for assembled centreline chains. The skeleton stops about
// one stroke radius short of every ink tip; each true open end is walked
// forward through the ink to the tip (ADR-397 runs this before gap bridging,
// so bridges measure the drawn gap).

import type { Vec2 } from '../../scene';
import type { InkMask } from './distance-field';
import type { Chain } from './junction-pairing';
import { landmarkGrid } from './point-grid';
import { pointAtArcDistance, radiusAtPosition } from './polyline-window';

const TANGENT_PROBE_PX = 3;
const TIP_STEP_PX = 0.5;

// A chain end that terminates AT a junction is not a stroke tip — it is an
// unpaired arm of a crossing and must not be extended into the ink.
export function isTrueTip(
  chain: Chain,
  which: 'start' | 'end',
  junctions: ReadonlyArray<Vec2>,
  distSq: Float64Array,
  width: number,
): boolean {
  const tip = which === 'start' ? chain.points[0] : chain.points.at(-1);
  if (tip === undefined) return false;
  const guard = Math.max(1.5, 1.5 * radiusAtPosition(tip, distSq, width));
  return !landmarkGrid(junctions).anyWithin(tip, guard);
}

// Extend an open end to the true ink tip by FOLLOWING the stroke, not by
// firing a straight ray — a straight ray exits the side of a curving stroke
// after a pixel or two. Each step picks the most forward-and-centred ink
// direction and the heading is refreshed, so the extension bends with the
// stroke — but every candidate stays hard-coned to the INITIAL tangent.
// Inside a round cap the distance field is radial (no restoring force), so
// an unanchored heading random-walks angularly and can veer 90° off-axis;
// the medial continuation through a cap is straight, so anchor to it.
export function extendTip(
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
const EDGE_NUDGE_PX = 1e-6;

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
    // A half-pixel step from a pixel centre lands exactly on a pixel edge.
    // Judge that edge from the side the walk arrives on, so a tip reaches
    // the ink boundary in every direction; rounding the edge itself reached
    // it walking left or up but stopped half a pixel short walking right or
    // down, which skewed every measured gap by that half pixel.
    const arriving = { x: candidate.x - d.x * EDGE_NUDGE_PX, y: candidate.y - d.y * EDGE_NUDGE_PX };
    if (!isInk(arriving, mask)) continue;
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
