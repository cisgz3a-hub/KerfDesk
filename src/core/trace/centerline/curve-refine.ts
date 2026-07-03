// Output curve refinement. Douglas-Peucker alone emits sparse polygonal
// vertices, and the app draws those chords literally — every curve renders
// as visible flat facets with kinks (the faceted-letters defect). Round the
// simplified polyline with corner-preserving Chaikin subdivision: vertices
// that turn harder than the pin threshold are DRAWN corners (the bend
// sharpener put them there) and stay exact; everything else converges to a
// smooth quadratic B-spline, matching the visual quality of the sampled
// curves the potrace-backed presets emit.

import type { Vec2 } from '../../scene';

const CORNER_PIN_RAD = (35 * Math.PI) / 180;
const CHAIKIN_ITERATIONS = 2;
const NEAR_POINT_EPS = 1e-9;

type FlaggedPoint = { readonly p: Vec2; readonly anchor: boolean };

/** Round a simplified chain for output. Corners and open-chain endpoints
 *  stay exact; smooth spans subdivide into gentle curves. */
export function refineChainForOutput(points: ReadonlyArray<Vec2>, closed: boolean): Vec2[] {
  if (points.length < 3) return [...points];
  let flagged = flagAnchors(points, closed);
  for (let iteration = 0; iteration < CHAIKIN_ITERATIONS; iteration += 1) {
    flagged = chaikinOnce(flagged, closed);
  }
  return flagged.map((f) => f.p);
}

function flagAnchors(points: ReadonlyArray<Vec2>, closed: boolean): FlaggedPoint[] {
  const n = points.length;
  return points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return { p, anchor: true };
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    if (prev === undefined || next === undefined) return { p, anchor: true };
    return { p, anchor: turnAt(prev, p, next) >= CORNER_PIN_RAD };
  });
}

function turnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLen < NEAR_POINT_EPS || outLen < NEAR_POINT_EPS) return 0;
  const dot =
    ((at.x - prev.x) / inLen) * ((next.x - at.x) / outLen) +
    ((at.y - prev.y) / inLen) * ((next.y - at.y) / outLen);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// One corner-preserving Chaikin pass: each edge contributes its quarter
// points, except that an anchor vertex is emitted exactly and never cut.
function chaikinOnce(flagged: ReadonlyArray<FlaggedPoint>, closed: boolean): FlaggedPoint[] {
  const n = flagged.length;
  const out: FlaggedPoint[] = [];
  const edgeCount = closed ? n : n - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const a = flagged[i];
    const b = flagged[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    if (a.anchor) out.push(a);
    else out.push({ p: lerp(a.p, b.p, 0.25), anchor: false });
    if (!b.anchor) out.push({ p: lerp(a.p, b.p, 0.75), anchor: false });
  }
  if (!closed) {
    const last = flagged[n - 1];
    if (last !== undefined) out.push(last);
  }
  return out;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
