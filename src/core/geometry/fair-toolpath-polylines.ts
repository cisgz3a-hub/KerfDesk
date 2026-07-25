// Machine-aware polyline fairing (CNC chatter audit, 2026-07-25). Traced
// polylines are denominated in pixels and tuned for visual fidelity; a
// machine follows every vertex as a G1 endpoint, so pixel-scale vertex
// spacing with 15-25deg heading jitter becomes a lateral-impulse train at
// feed/segment-length Hz — audible chatter. GRBL's junction limiter never
// brakes for bends that shallow (planner.c: v^2 = a*d*cos(t/2)/(1-cos(t/2))),
// so the geometry itself must be even. This pass rebuilds each polyline in
// PHYSICAL units: resample spans to a minimum chord length, smooth the
// residual heading noise, and clamp total deviation — while pinning genuine
// corners and open-chain endpoints exactly.

import type { Polyline, Vec2 } from '../scene';

export type ToolpathFairOptions = {
  /** Physical size of one polyline unit (trace pixel), mm. Non-finite or
   *  non-positive disables the pass (input returned unchanged). */
  readonly mmPerPx: number;
  /** Minimum output chord length away from pinned corners, mm. */
  readonly minSegmentMm: number;
  /** Cap on smoothing displacement per vertex, mm — bounds how far the cut
   *  may drift from the traced boundary. */
  readonly maxDeviationMm: number;
  /** Turns at least this sharp are drawn corners: pinned exactly, never
   *  smoothed, and chords between two nearby corners may undershoot the
   *  minimum segment (corners win over the floor). */
  readonly cornerAngleDeg: number;
};

const MIN_FAIR_POINTS = 4;
const RING_DUPLICATE_EPS = 1e-6;
const SMOOTHING_PASSES = 2;
// Corner detection window, px. On a ~1px-pitch jittered chain a drawn 90deg
// corner splits its turn across two adjacent vertices (each under the corner
// angle), so turns are measured over chords +-this arclength around each
// vertex — the same windowed-turn approach the trace finisher's dense corner
// detector uses — with greedy non-max suppression so one physical corner
// yields one pin.
const CORNER_WINDOW_PX = 2;

/** Fair traced polylines for machine execution. Pure and deterministic;
 *  returns the input array unchanged when the scale is unusable. */
export function fairToolpathPolylines(
  polylines: ReadonlyArray<Polyline>,
  options: ToolpathFairOptions,
): Polyline[] {
  if (!Number.isFinite(options.mmPerPx) || options.mmPerPx <= 0) return [...polylines];
  const minSegmentPx = options.minSegmentMm / options.mmPerPx;
  const maxDeviationPx = options.maxDeviationMm / options.mmPerPx;
  return polylines.map((polyline) =>
    fairOne(polyline, minSegmentPx, maxDeviationPx, options.cornerAngleDeg),
  );
}

function fairOne(
  polyline: Polyline,
  minSegmentPx: number,
  maxDeviationPx: number,
  cornerAngleDeg: number,
): Polyline {
  if (polyline.points.length < MIN_FAIR_POINTS) return polyline;
  const ring = polyline.closed;
  const points = ring ? stripRingDuplicate(polyline.points) : [...polyline.points];
  if (points.length < MIN_FAIR_POINTS) return polyline;
  const pinned = pinnedIndices(points, ring, cornerAngleDeg);
  const spans = spansBetweenPins(points.length, ring, pinned);
  const out: Vec2[] = [];
  for (const span of spans) {
    const chain = chainForSpan(points, span);
    // Smooth BEFORE resampling: the kernel sees the dense chain (adjacent-
    // vertex jitter dies at full statistics) and the subsequent resample
    // emits exact even chords — smoothing after resampling contracted
    // corner-adjacent chords below the floor.
    const smoothed = smoothInterior(chain, maxDeviationPx);
    const resampled = resampleChain(smoothed, minSegmentPx);
    // Spans share endpoints; skip the first vertex of every span but the
    // first so shared pins are emitted once.
    out.push(...(out.length === 0 ? resampled : resampled.slice(1)));
  }
  if (ring) {
    // The last span ends back at the first pin; replace the duplicate with
    // an exact ring closure (ADR-100 third amendment: explicit return).
    out.pop();
    const first = out[0];
    if (first !== undefined) out.push({ x: first.x, y: first.y });
  }
  return { points: out, closed: polyline.closed };
}

// Closed traced rings carry an explicit closing duplicate (last == first);
// drop it for cyclic processing, re-added on output.
function stripRingDuplicate(points: ReadonlyArray<Vec2>): Vec2[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [...points];
  const dupe = Math.hypot(last.x - first.x, last.y - first.y) <= RING_DUPLICATE_EPS;
  return dupe ? points.slice(0, -1) : [...points];
}

// Pins: open-chain endpoints, plus corner vertices. A vertex's corner score
// is the max of its exact turn (catches corners whose legs are long, single
// segments — a drawn notch) and its windowed turn (catches corners split
// across adjacent vertices on ~1px-pitch jittered chains). Suppression is by
// ARCLENGTH, not vertex count — segment lengths on traced chains vary 30:1,
// so a vertex radius either merges genuinely distinct nearby corners or
// double-pins one jittered apex. A candidate survives only when it is at
// least the corner window away from every stronger pin: a 2px notch keeps
// both corners; a jittered apex cluster (<=1px spread) collapses to one.
// A cornerless ring pins its seam (index 0) so spans stay simple — the seam
// lies on the traced path, so the cost is one unsmoothed vertex.
function pinnedIndices(
  points: ReadonlyArray<Vec2>,
  ring: boolean,
  cornerAngleDeg: number,
): number[] {
  const n = points.length;
  const prefix = prefixArclengths(points, ring);
  const total = prefix[n] as number;
  const step = Math.max(1, Math.round((CORNER_WINDOW_PX * n) / Math.max(1e-9, total)));
  const turns: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    if (!ring && (i === 0 || i === n - 1)) continue;
    const windowed = !ring && (i < step || i >= n - step) ? 0 : turnOverStep(points, i, step, ring);
    // The exact per-vertex turn is only evidence when both legs are at least
    // the corner window long: on a ~1px-pitch jittered chain, adjacent
    // deltas reach the full jitter band and fake turns up to ~84deg, while a
    // drawn corner with long single-segment legs (a notch) is unmistakable.
    const legPrev = distanceAt(points, i, -1, ring);
    const legNext = distanceAt(points, i, +1, ring);
    const exact =
      legPrev >= CORNER_WINDOW_PX && legNext >= CORNER_WINDOW_PX
        ? turnOverStep(points, i, 1, ring)
        : 0;
    turns[i] = Math.max(exact, windowed);
  }
  const pins = arclengthNms(turns, prefix, total, ring, cornerAngleDeg);
  if (!ring) {
    pins.push(0, n - 1);
  } else if (pins.length === 0) {
    pins.push(0);
  }
  return [...new Set(pins)].sort((a, b) => a - b);
}

// Cumulative arclength; index n holds the total (including the closing edge
// for rings).
function prefixArclengths(points: ReadonlyArray<Vec2>, ring: boolean): number[] {
  const prefix: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    prefix.push((prefix[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  prefix.push(
    (prefix[points.length - 1] as number) +
      (ring ? Math.hypot(first.x - last.x, first.y - last.y) : 0),
  );
  return prefix;
}

function distanceAt(points: ReadonlyArray<Vec2>, i: number, dir: -1 | 1, ring: boolean): number {
  const n = points.length;
  const j = ring ? (i + dir + n) % n : Math.min(n - 1, Math.max(0, i + dir));
  const a = points[i] as Vec2;
  const b = points[j] as Vec2;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function turnOverStep(points: ReadonlyArray<Vec2>, i: number, step: number, ring: boolean): number {
  const n = points.length;
  const prev = points[ring ? (i - step + n) % n : Math.max(0, i - step)] as Vec2;
  const at = points[i] as Vec2;
  const next = points[ring ? (i + step) % n : Math.min(n - 1, i + step)] as Vec2;
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLen <= 0 || outLen <= 0) return 0;
  const dot =
    ((at.x - prev.x) * (next.x - at.x) + (at.y - prev.y) * (next.y - at.y)) / (inLen * outLen);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

// Greedy arclength non-max suppression: strongest turns first; a candidate
// closer than the corner window (along the chain, cyclic on rings) to any
// taken pin is the same physical corner and is dropped.
function arclengthNms(
  turns: ReadonlyArray<number>,
  prefix: ReadonlyArray<number>,
  total: number,
  ring: boolean,
  cornerAngleDeg: number,
): number[] {
  const n = turns.length;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (turns[b] ?? 0) - (turns[a] ?? 0),
  );
  const pins: number[] = [];
  for (const i of order) {
    if ((turns[i] ?? 0) < cornerAngleDeg) break;
    const si = prefix[i] as number;
    const clear = pins.every((p) => {
      const raw = Math.abs(si - (prefix[p] as number));
      const dist = ring ? Math.min(raw, total - raw) : raw;
      return dist >= CORNER_WINDOW_PX;
    });
    if (clear) pins.push(i);
  }
  return pins;
}

type Span = { readonly from: number; readonly to: number };

// Consecutive pin pairs. Open chains: pins always include both endpoints.
// Rings: spans wrap; a single pin yields one full-circle span from the pin
// back to itself.
function spansBetweenPins(count: number, ring: boolean, pins: ReadonlyArray<number>): Span[] {
  const spans: Span[] = [];
  if (!ring) {
    for (let i = 1; i < pins.length; i += 1) {
      spans.push({ from: pins[i - 1] as number, to: pins[i] as number });
    }
    return spans;
  }
  for (let i = 0; i < pins.length; i += 1) {
    const from = pins[i] as number;
    const to = pins[(i + 1) % pins.length] as number;
    spans.push({ from, to: to <= from ? to + count : to });
  }
  return spans;
}

function chainForSpan(points: ReadonlyArray<Vec2>, span: Span): Vec2[] {
  const n = points.length;
  const chain: Vec2[] = [];
  for (let i = span.from; i <= span.to; i += 1) {
    chain.push(points[i % n] as Vec2);
  }
  return chain;
}

// Even-arclength resample ON the original chain: endpoints exact, interior
// vertices linearly interpolated along the source polyline, chord length in
// [step, 2*step). A span shorter than one step keeps only its endpoints —
// that is the micro-fragment merge.
function resampleChain(chain: ReadonlyArray<Vec2>, step: number): Vec2[] {
  const cumulative: number[] = [0];
  for (let i = 1; i < chain.length; i += 1) {
    const a = chain[i - 1] as Vec2;
    const b = chain[i] as Vec2;
    cumulative.push((cumulative[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[cumulative.length - 1] as number;
  const first = chain[0] as Vec2;
  const last = chain[chain.length - 1] as Vec2;
  const segments = Math.max(1, Math.floor(total / step));
  const out: Vec2[] = [{ x: first.x, y: first.y }];
  let cursor = 1;
  for (let k = 1; k < segments; k += 1) {
    const target = (k * total) / segments;
    while (cursor < cumulative.length - 1 && (cumulative[cursor] as number) < target) cursor += 1;
    const segStart = cumulative[cursor - 1] as number;
    const segEnd = cumulative[cursor] as number;
    const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
    const a = chain[cursor - 1] as Vec2;
    const b = chain[cursor] as Vec2;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  out.push({ x: last.x, y: last.y });
  return out;
}

// Two passes of a 1/4-1/2-1/4 kernel on interior vertices, then a clamp of
// each vertex's total displacement to the deviation cap. Span endpoints are
// pins and never move. Adjacent-vertex alternation (the quantization-jitter
// signature) sits at the kernel's zero, so it dies in one pass; drawn
// curvature (low frequency) passes through nearly unchanged.
function smoothInterior(points: ReadonlyArray<Vec2>, maxDeviationPx: number): Vec2[] {
  if (points.length < 3) return [...points];
  let current = points.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    const next = current.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < current.length - 1; i += 1) {
      const a = current[i - 1] as Vec2;
      const b = current[i] as Vec2;
      const c = current[i + 1] as Vec2;
      next[i] = { x: 0.25 * a.x + 0.5 * b.x + 0.25 * c.x, y: 0.25 * a.y + 0.5 * b.y + 0.25 * c.y };
    }
    current = next;
  }
  return current.map((p, i) => clampDisplacement(points[i] as Vec2, p, maxDeviationPx));
}

function clampDisplacement(origin: Vec2, moved: Vec2, cap: number): Vec2 {
  const dx = moved.x - origin.x;
  const dy = moved.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= cap || dist === 0) return moved;
  const scale = cap / dist;
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}
