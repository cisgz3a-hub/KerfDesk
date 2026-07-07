// Curvature-safe straightening of near-straight runs in a traced chain.
//
// Rough source edges leave low-amplitude, long-wavelength waviness that
// survives both Taubin evening (local) and Douglas-Peucker (keeps anything
// over ε): a nominally straight letter stem traces wobbly. Wobble and genuine
// curvature differ in SIGN PATTERN, not amplitude: noise OSCILLATES across
// the run's chord (significant deviation on BOTH sides), while an arc bows to
// ONE side (its sagitta is single-signed). Flattening therefore requires
// oscillation evidence — circles and gentle arcs keep every vertex no matter
// how shallow, and one-sided sags below the simplifier's ε were already
// collapsed upstream.

import type { Vec2 } from '../scene';

// A run must be at least this long to flatten — protects small-glyph detail.
const MIN_RUN_LENGTH_PX = 8;
// Baseline wobble amplitude the flattener may erase at maxDeviationPx = 1.
// Deliberately conservative: hand-drawn art (waves, hatching) oscillates at
// the same amplitude as edge noise, so aggressiveness is a CALLER choice
// (the trace dialog's Smoothness knob), not a constant.
const BASE_MAX_DEVIATION_PX = 1.0;
// Both chord sides must see at least this much deviation to call it wobble.
const MIN_OSCILLATION_PX = 0.15;
// Below this the flattener is effectively off; skip the scan.
const MIN_ACTIVE_DEVIATION_PX = 0.2;

/** Replace near-straight vertex runs with their chord. Corner vertices are
 *  never removed (they may terminate a run, never sit inside one). For a
 *  closed chain the scan starts at the vertex farthest from the centroid —
 *  the same anchor choice the simplifier makes — so the seam does not split
 *  a straight run in the common case. `strength` scales the amplitude the
 *  flattener may erase (1 = the conservative baseline; 0 disables). */
export function flattenStraightRuns(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  strength = 1,
): Vec2[] {
  const maxDeviationPx = BASE_MAX_DEVIATION_PX * Math.max(0, strength);
  if (points.length < 4 || maxDeviationPx < MIN_ACTIVE_DEVIATION_PX) return [...points];
  const ring = closed ? rotateToFarthest(points) : [...points];
  const out: Vec2[] = [];
  let i = 0;
  while (i < ring.length - 1) {
    const j = longestFlattenableRunEnd(ring, i, corners, maxDeviationPx);
    out.push(ring[i] as Vec2);
    i = j > i + 1 ? j : i + 1;
  }
  out.push(ring[ring.length - 1] as Vec2);
  // rotateToFarthest closes the ring by repeating the anchor; restore the
  // no-repeated-first-point ring convention on the way out.
  if (closed && out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

// Greedy: extend the run while every interior vertex stays within the
// amplitude cap of chord(start, end) and no corner sits strictly inside.
// A one-sided prefix keeps extending (the far side of the oscillation may
// arrive later); only a run that showed BOTH sides qualifies. Returns the
// end index of the longest qualifying run, or start (no run).
function longestFlattenableRunEnd(
  ring: ReadonlyArray<Vec2>,
  start: number,
  corners: ReadonlySet<Vec2>,
  maxDeviationPx: number,
): number {
  let best = start;
  for (let end = start + 2; end < ring.length; end += 1) {
    const interior = ring[end - 1] as Vec2;
    if (corners.has(interior)) break;
    const shape = classifyRun(ring, start, end, maxDeviationPx);
    if (shape === 'too-bumpy') break;
    if (shape !== 'wobble') continue;
    if (chordLength(ring[start] as Vec2, ring[end] as Vec2) >= MIN_RUN_LENGTH_PX) best = end;
  }
  return best;
}

function classifyRun(
  ring: ReadonlyArray<Vec2>,
  start: number,
  end: number,
  maxDeviationPx: number,
): 'too-bumpy' | 'one-sided' | 'wobble' {
  const a = ring[start] as Vec2;
  const b = ring[end] as Vec2;
  if (chordLength(a, b) < 1e-9) return 'one-sided';
  let maxSigned = 0;
  let minSigned = 0;
  for (let k = start + 1; k < end; k += 1) {
    const d = signedPerpendicularDistance(ring[k] as Vec2, a, b);
    if (Math.abs(d) > maxDeviationPx) return 'too-bumpy';
    maxSigned = Math.max(maxSigned, d);
    minSigned = Math.min(minSigned, d);
  }
  // Oscillation on both chord sides = wobble; one-sided bow = genuine arc.
  const oscillates = maxSigned >= MIN_OSCILLATION_PX && minSigned <= -MIN_OSCILLATION_PX;
  return oscillates ? 'wobble' : 'one-sided';
}

function signedPerpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-18) return chordLength(p, a);
  return ((p.x - a.x) * vy - (p.y - a.y) * vx) / Math.sqrt(lenSq);
}

function chordLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rotateToFarthest(points: ReadonlyArray<Vec2>): Vec2[] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let anchor = 0;
  let bestDistSq = -1;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i] as Vec2;
    const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
    if (d > bestDistSq) {
      bestDistSq = d;
      anchor = i;
    }
  }
  return [...points.slice(anchor), ...points.slice(0, anchor), points[anchor] as Vec2];
}
