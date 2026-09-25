// Corner-anchored smooth resampling of a simplified polyline.
//
// Douglas-Peucker leaves sparse vertices, and the app draws the chords
// between them literally. Chaikin rounding of those chords quarter-cuts every
// edge, but a pinned soft-turn vertex keeps its two straight chords and reads
// as a facet — so Chaikin cannot make an already-evened curve turn evenly.
// A centripetal Catmull-Rom spline instead passes THROUGH the vertices with a
// continuous tangent, so a moderate turn between two vertices becomes a smooth
// arc rather than a kink. Only genuine corners break the spline; each is
// emitted exactly (its original object, for reference-based pinning) and its
// legs stay straight because the spline is split there.
//
// Centripetal (alpha = 0.5) parameterisation is chosen over uniform: it
// provably never cusps or self-intersects between control points, so the
// resample cannot bulge off the true curve near unevenly-spaced vertices.

import type { Vec2 } from '../../scene';

// alpha = 0.5 knot exponent: the centripetal variant. sqrt(distance) spacing.
const CENTRIPETAL_ALPHA = 0.5;
const NEAR_POINT_EPS = 1e-9;

/**
 * Resample a simplified chain into a smooth polyline. Non-corner vertices are
 * interpolated by a centripetal Catmull-Rom spline; corners break the spline
 * and are emitted exactly. `samplesPerSegment` new points are placed inside
 * each spline segment (1 = midpoint only).
 *
 * `deviationCapPx`, when finite, bounds how far any resampled interior sample
 * may sit perpendicular from its own `p1->p2` chord, on either side. Pass the
 * Douglas-Peucker tolerance ε used upstream: DP guarantees the dense chain
 * lies within ε of each simplified chord, so a legitimate arc's sagitta
 * between simplified vertices is ≤ ε and stays untouched, while a spline that
 * bows further than ε into empty paper (the serif-foot "smile" overshoot) is
 * pulled back to the chord ± ε. Omit or pass Infinity to disable the cap.
 *
 * `chordBand`, when given, narrows that cap per chord and per side: the
 * signed perpendicular offsets the resample may take from the chord `a->b`
 * (left of the chord is positive). The contour tail passes the offsets of
 * the dense sub-chain the simplification collapsed onto each chord, so a
 * straight run cannot bow into paper while an arc keeps its sagitta.
 */
export function fitSmoothCurve(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  samplesPerSegment: number,
  deviationCapPx = Infinity,
  chordBand?: ChordBand,
): Vec2[] {
  if (points.length < 3) return [...points];
  const runs = splitAtCorners(points, closed, corners);
  const out: Vec2[] = [];
  const bound = { capPx: deviationCapPx, band: chordBand };
  for (const run of runs) appendRun(out, run.points, run.closed, samplesPerSegment, bound);
  if (closed && out.length > 0) {
    // `out.length > 0` proves both ends are present; noUncheckedIndexedAccess
    // still types them optional, so assert past the (checked) undefined.
    const first = out[0] as Vec2;
    const last = out.at(-1) as Vec2;
    // A fully-smooth ring (no corners) is emitted as a closed run whose last
    // sample already equals the first; drop the duplicate so callers that add
    // the implicit closing edge do not double it.
    if (Math.hypot(last.x - first.x, last.y - first.y) < NEAR_POINT_EPS) out.pop();
  }
  return out;
}

/** Signed offset limits from the chord `a->b` (left positive; `below` <= 0
 *  <= `above`), or null for no limit beyond the deviation cap. */
export type ChordBand = (
  a: Vec2,
  b: Vec2,
) => { readonly below: number; readonly above: number } | null;

type Run = { readonly points: Vec2[]; readonly closed: boolean };
type SampleBound = { readonly capPx: number; readonly band: ChordBand | undefined };

// Break the chain at every corner. A closed chain with no corners stays one
// closed run; otherwise each run is an OPEN arc that starts and ends on a
// corner (or, for an open chain, on an endpoint).
function splitAtCorners(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
): Run[] {
  const cornerIdx: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p !== undefined && corners.has(p)) cornerIdx.push(i);
  }
  if (!closed) return openRunsBetween(points, cornerIdx);
  if (cornerIdx.length === 0) return [{ points: [...points], closed: true }];
  return closedRunsBetween(points, cornerIdx);
}

// Open chain: endpoints already anchor the ends, so split only at interior
// corners. Consecutive runs share the corner vertex (same object).
function openRunsBetween(points: ReadonlyArray<Vec2>, cornerIdx: ReadonlyArray<number>): Run[] {
  const breaks = [0, ...cornerIdx.filter((i) => i > 0 && i < points.length - 1), points.length - 1];
  const runs: Run[] = [];
  for (let k = 0; k + 1 < breaks.length; k += 1) {
    const lo = breaks[k] as number;
    const hi = breaks[k + 1] as number;
    runs.push({ points: points.slice(lo, hi + 1), closed: false });
  }
  return runs;
}

// Closed chain with corners: walk corner-to-corner around the ring, each run
// an open arc including both bounding corners. With exactly ONE corner the
// single run wraps the FULL ring back to the same corner (start === end must
// not mean zero steps — that collapsed a one-corner ring, e.g. a traced
// letter-O counter, to a single point that the seam dedupe then emptied).
function closedRunsBetween(points: ReadonlyArray<Vec2>, cornerIdx: ReadonlyArray<number>): Run[] {
  const n = points.length;
  const runs: Run[] = [];
  for (let k = 0; k < cornerIdx.length; k += 1) {
    const start = cornerIdx[k] as number;
    const end = cornerIdx[(k + 1) % cornerIdx.length] as number;
    const arc: Vec2[] = [];
    let i = start;
    // Inclusive of both corners, wrapping around the seam.
    for (let step = 0; step <= n; step += 1) {
      const p = points[i];
      if (p !== undefined) arc.push(p);
      if (i === end && step > 0) break;
      i = (i + 1) % n;
    }
    runs.push({ points: arc, closed: false });
  }
  return runs;
}

// Sample one run into `out` (without repeating the shared boundary vertex).
function appendRun(
  out: Vec2[],
  run: ReadonlyArray<Vec2>,
  closed: boolean,
  samplesPerSegment: number,
  bound: SampleBound,
): void {
  if (run.length < 2) {
    for (const p of run) pushUnique(out, p);
    return;
  }
  const n = run.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i += 1) {
    // i and (i+1)%n are in [0,n) for a run of length n >= 2, so the modular
    // reads are defined; assert past noUncheckedIndexedAccess's optional type.
    const p0 = phantomBefore(run, i, closed);
    const p1 = run[i % n] as Vec2;
    const p2 = run[(i + 1) % n] as Vec2;
    const p3 = phantomAfter(run, i, closed);
    // Emit the segment's start vertex exactly (keeps corner/endpoint objects),
    // then the interior samples. The next segment emits p2 as its start.
    pushUnique(out, p1);
    const { below, above } = chordLimits(bound, p1, p2);
    for (let s = 1; s <= samplesPerSegment; s += 1) {
      const t = s / (samplesPerSegment + 1);
      out.push(capDeviation(centripetalPoint(p0, p1, p2, p3, t), p1, p2, below, above));
    }
  }
  if (!closed) pushUnique(out, run[n - 1] as Vec2);
}

// The signed offsets a sample of chord a->b may take: the deviation cap on
// both sides, narrowed by the chord's band when one is given.
function chordLimits(bound: SampleBound, a: Vec2, b: Vec2): { below: number; above: number } {
  const band = bound.band?.(a, b) ?? null;
  return {
    below: Math.max(-bound.capPx, band?.below ?? -Infinity),
    above: Math.min(bound.capPx, band?.above ?? Infinity),
  };
}

// Pull a resampled sample back toward its `a->b` chord when its signed
// perpendicular offset leaves [below, above] (left of the chord positive),
// keeping the along-chord component. The spline may smooth (deviation within
// the cap) but may not invent geometry beyond the simplification tolerance,
// arc or corner alike. The correction moves the sample along the chord's
// normal toward its foot point, so it goes toward the chord by construction
// (a signed-normal formulation here once moved samples AWAY on one side, the
// round-1 sign bug; the clamp below only ever shrinks the offset's size).
function capDeviation(q: Vec2, a: Vec2, b: Vec2, below: number, above: number): Vec2 {
  if (!Number.isFinite(below) && !Number.isFinite(above)) return q;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy);
  if (len < NEAR_POINT_EPS) return q;
  const nx = -vy / len;
  const ny = vx / len;
  const offset = (q.x - a.x) * nx + (q.y - a.y) * ny;
  const clamped = Math.min(Math.max(offset, Math.min(below, 0)), Math.max(above, 0));
  if (clamped === offset) return q;
  return { x: q.x + (clamped - offset) * nx, y: q.y + (clamped - offset) * ny };
}

// The control point before segment i. At an open run's first segment there is
// no predecessor: CLAMP to the endpoint (zero end tangent) rather than mirror.
// Mirroring extrapolates a phantom outside the run and lets the first segment
// bow away from the true curve near a corner (the small-glyph overshoot);
// clamping cannot pull the curve past its own endpoint.
function phantomBefore(run: ReadonlyArray<Vec2>, i: number, closed: boolean): Vec2 {
  const n = run.length;
  // Index guarded by caller (segment loop) and the closed/open branches.
  if (closed) return run[(i - 1 + n) % n] as Vec2;
  if (i - 1 >= 0) return run[i - 1] as Vec2;
  return run[0] as Vec2;
}

function phantomAfter(run: ReadonlyArray<Vec2>, i: number, closed: boolean): Vec2 {
  const n = run.length;
  // Index guarded by caller (segment loop) and the closed/open branches.
  if (closed) return run[(i + 2) % n] as Vec2;
  if (i + 2 <= n - 1) return run[i + 2] as Vec2;
  return run[n - 1] as Vec2;
}

// Centripetal Catmull-Rom interpolation of p1->p2 at local parameter t in
// [0,1], using neighbours p0 and p3. Reduces to a straight line when the four
// points are collinear, so straight legs stay straight.
function centripetalPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  // Degenerate knot spans (coincident control points) collapse to linear.
  if (t1 - t0 < NEAR_POINT_EPS || t2 - t1 < NEAR_POINT_EPS || t3 - t2 < NEAR_POINT_EPS) {
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  }
  const tt = t1 + (t2 - t1) * t;
  const a1 = lerpT(p0, p1, t0, t1, tt);
  const a2 = lerpT(p1, p2, t1, t2, tt);
  const a3 = lerpT(p2, p3, t2, t3, tt);
  const b1 = lerpT(a1, a2, t0, t2, tt);
  const b2 = lerpT(a2, a3, t1, t3, tt);
  return lerpT(b1, b2, t1, t2, tt);
}

function knot(a: Vec2, b: Vec2): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.pow(Math.max(dist, NEAR_POINT_EPS), CENTRIPETAL_ALPHA);
}

function lerpT(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
  const span = tb - ta;
  if (span < NEAR_POINT_EPS) return a;
  const u = (t - ta) / span;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function pushUnique(out: Vec2[], p: Vec2): void {
  const last = out.at(-1);
  if (last !== undefined && Math.hypot(last.x - p.x, last.y - p.y) < NEAR_POINT_EPS) return;
  out.push(p);
}
