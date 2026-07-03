import type { Vec2 } from '../scene';

type PointLike = {
  x: number;
  y: number;
};

export type PotraceCurveTag = 'CURVE' | 'CORNER';

export type PotraceCurveSegment = {
  readonly tag: PotraceCurveTag;
  readonly vertex: PointLike;
  readonly c: readonly [PointLike, PointLike, PointLike];
  readonly alpha: number;
  readonly alpha0: number;
  readonly beta: number;
};

export type PotraceCurve = {
  readonly segments: ReadonlyArray<PotraceCurveSegment>;
  readonly alphaCurve: boolean;
};

const POTRACE_MIN_CURVE_ALPHA = 0.55;
const POTRACE_MAX_CURVE_ALPHA = 1;
const DEFAULT_CUBIC_SAMPLES = 16;
const GEOMETRY_EPS = 1e-9;

// Small-feature corner protection (2026-07-03 melt fix).
//
// The corner-vs-curve test compares each vertex's raw alpha against the
// global alphaMax. At the preset default smoothness (alphaMax = 1.0) that
// threshold is so high that the shallow raw alphas produced by SHORT polygon
// legs — the 2–4px legs of ~16px glyph strokes — always fall below it, so
// every drawn corner is tagged CURVE and rounded into a blob. Large arcs,
// whose legs are long, are unaffected: they legitimately want curves.
//
// The fix scales the effective alpha limit DOWN toward the crisp "Sharp"
// value on short legs and back UP to the caller's alphaMax on long legs, so
// the same input crisps where it must (small text) and curves where it
// should (big discs). Leg thresholds are in source pixels.
const CORNER_LEG_LO_PX = 3;
const CORNER_LEG_HI_PX = 7;
// The short-leg floor is deliberately POTRACE_MIN_CURVE_ALPHA (0.55): it is
// the empirically crisp "Sharp" preset value, and reusing it makes the
// invariant below exact — when a caller passes alphaMax <= 0.55 the min()
// collapses to alphaMax and this whole ramp is a no-op.
const SMALL_FEATURE_ALPHA_MAX = POTRACE_MIN_CURVE_ALPHA;

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function pointAt(points: readonly PointLike[], index: number): PointLike {
  const point = points[index];
  if (point === undefined) throw new Error(`Missing Potrace point at ${index}`);
  return point;
}

function segmentAt(curve: PotraceCurve, index: number): PotraceCurveSegment {
  const segment = curve.segments[index];
  if (segment === undefined) throw new Error(`Missing Potrace curve segment at ${index}`);
  return segment;
}

function copyPoint(point: PointLike): PointLike {
  return { x: point.x, y: point.y };
}

function interval(lambda: number, a: PointLike, b: PointLike): PointLike {
  return {
    x: a.x + lambda * (b.x - a.x),
    y: a.y + lambda * (b.y - a.y),
  };
}

function dpara(a: PointLike, b: PointLike, c: PointLike): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function ddist(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bezier(t: number, p0: PointLike, p1: PointLike, p2: PointLike, p3: PointLike): PointLike {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * t * t * s * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * t * t * s * p2.y + t * t * t * p3.y,
  };
}

function ddenom(a: PointLike, c: PointLike): number {
  const r = {
    x: sign(c.y - a.y),
    y: -sign(c.x - a.x),
  };
  return r.y * (c.x - a.x) - r.x * (c.y - a.y);
}

function clampCurveAlpha(alpha: number): number {
  return Math.max(POTRACE_MIN_CURVE_ALPHA, Math.min(POTRACE_MAX_CURVE_ALPHA, alpha));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Per-vertex effective corner/curve alpha limit, scaled by local polygon leg
 * length. Short legs (small features) ramp the limit down toward the crisp
 * {@link SMALL_FEATURE_ALPHA_MAX}; long legs (large arcs) leave it at the
 * caller's `alphaMax`.
 *
 * Invariant: when `alphaMax <= SMALL_FEATURE_ALPHA_MAX` the `Math.min` returns
 * `alphaMax` for every leg length, so behavior is IDENTICAL to a plain global
 * limit. This is what proves the "Sharp" preset (smoothness 0.55) is unchanged.
 */
export function smallFeatureEffectiveAlphaMax(alphaMax: number, minLegPx: number): number {
  const t = clamp01((minLegPx - CORNER_LEG_LO_PX) / (CORNER_LEG_HI_PX - CORNER_LEG_LO_PX));
  return Math.min(
    alphaMax,
    SMALL_FEATURE_ALPHA_MAX + (POTRACE_MAX_CURVE_ALPHA - SMALL_FEATURE_ALPHA_MAX) * t,
  );
}

export function potraceAlphaForVertex(
  previous: PointLike,
  vertex: PointLike,
  next: PointLike,
): number {
  const denom = ddenom(previous, next);
  if (denom === 0) return 4 / 3;

  const dd = Math.abs(dpara(previous, vertex, next) / denom);
  return (dd > 1 ? 1 - 1 / dd : 0) / 0.75;
}

export function smoothClosedPolygonToPotraceCurve(
  points: readonly PointLike[],
  alphaMax: number,
): PotraceCurve {
  if (points.length < 2) return { segments: [], alphaCurve: false };

  const alphaLimit = Math.max(0, alphaMax);
  const segments: PotraceCurveSegment[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = pointAt(points, mod(index - 1, points.length));
    const vertex = pointAt(points, index);
    const next = pointAt(points, mod(index + 1, points.length));
    const endpoint = interval(0.5, next, vertex);
    const rawAlpha = potraceAlphaForVertex(previous, vertex, next);

    // Corner-vs-curve uses a PER-VERTEX limit scaled by the shorter of the two
    // adjoining polygon legs, so short-legged small-feature vertices stay crisp
    // while long-legged arc vertices still round (see constants above).
    const minLeg = Math.min(ddist(previous, vertex), ddist(vertex, next));
    const effectiveAlphaMax = smallFeatureEffectiveAlphaMax(alphaLimit, minLeg);

    if (alphaLimit <= 0 || rawAlpha >= effectiveAlphaMax) {
      segments.push({
        tag: 'CORNER',
        vertex: copyPoint(vertex),
        c: [copyPoint(vertex), copyPoint(vertex), endpoint],
        alpha: rawAlpha,
        alpha0: rawAlpha,
        beta: 0.5,
      });
      continue;
    }

    const alpha = clampCurveAlpha(rawAlpha);
    segments.push({
      tag: 'CURVE',
      vertex: copyPoint(vertex),
      c: [
        interval(0.5 + 0.5 * alpha, previous, vertex),
        interval(0.5 + 0.5 * alpha, next, vertex),
        endpoint,
      ],
      alpha,
      alpha0: rawAlpha,
      beta: 0.5,
    });
  }

  return { segments, alphaCurve: true };
}

export function potraceCurveToPolylinePoints(
  curve: PotraceCurve,
  samplesPerCubic = DEFAULT_CUBIC_SAMPLES,
): Vec2[] {
  const m = curve.segments.length;
  if (m === 0) return [];

  const samples = Math.max(1, Math.round(samplesPerCubic));
  const points: Vec2[] = [copyPoint(segmentAt(curve, m - 1).c[2])];

  for (const segment of curve.segments) {
    const start = pointAt(points, points.length - 1);
    if (segment.tag === 'CURVE') {
      for (let sample = 1; sample <= samples; sample += 1) {
        points.push(bezier(sample / samples, start, segment.c[0], segment.c[1], segment.c[2]));
      }
    } else {
      points.push(copyPoint(segment.c[1]));
      points.push(copyPoint(segment.c[2]));
    }
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first !== undefined && last !== undefined && ddist(first, last) > GEOMETRY_EPS) {
    points.push(copyPoint(first));
  }
  return points;
}
