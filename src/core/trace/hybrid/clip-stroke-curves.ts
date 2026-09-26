// Clip a centreline curve against the wide-ink region (ADR-454). The parts of
// a stroke that run inside the fill are removed; the parts outside survive as
// exact sub-curves (de Casteljau splits of the original cubics), so a clipped
// stroke keeps its compact cubic form instead of turning into a dense
// polyline. Each surviving piece records which of its ends was cut — that end
// lies on the fill boundary, which is the Line + fill junction rule.

import type { CurveSubpath, PathSegment, Vec2 } from '../../scene';

export type ClippedPiece = {
  readonly curve: CurveSubpath;
  /** The piece starts on the region boundary (a stroke/fill junction). */
  readonly startCut: boolean;
  /** The piece ends on the region boundary. */
  readonly endCut: boolean;
};

type Span = {
  readonly from: Vec2;
  readonly segment: PathSegment;
  readonly t0: number;
  readonly t1: number;
};

const SAMPLE_STEP_PX = 0.5;
const BISECTION_STEPS = 10;

/** The pieces of `curve` lying outside the region, in curve order. */
export function clipCurveOutsideRegion(
  curve: CurveSubpath,
  inRegion: (p: Vec2) => boolean,
): ClippedPiece[] {
  const spans: { span: Span; inside: boolean }[] = [];
  let from = curve.start;
  for (const segment of curve.segments) {
    for (const span of splitSegmentAtBoundary(from, segment, inRegion)) {
      spans.push({ span, inside: inRegion(pointAt(span.from, span.segment, mid(span))) });
    }
    from = segment.to;
  }
  if (spans.every((s) => !s.inside)) return [{ curve, startCut: false, endCut: false }];
  if (spans.every((s) => s.inside)) return [];
  const runs: Span[][] = [];
  let current: Span[] | null = null;
  for (const { span, inside } of spans) {
    if (inside) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [];
      runs.push(current);
    }
    current.push(span);
  }
  const firstOutside = spans[0]?.inside === false;
  const lastOutside = spans.at(-1)?.inside === false;
  // A closed curve cut somewhere: the run through its seam is one piece.
  if (curve.closed && firstOutside && lastOutside && runs.length > 1) {
    const head = runs.shift() ?? [];
    runs[runs.length - 1] = [...(runs.at(-1) ?? []), ...head];
  }
  return runs.map((run) => {
    const first = run[0];
    const last = run.at(-1);
    const startsAtCurveStart = !curve.closed && first === spans[0]?.span;
    const endsAtCurveEnd = !curve.closed && last === spans.at(-1)?.span;
    return {
      curve: {
        start: first === undefined ? curve.start : pointAt(first.from, first.segment, first.t0),
        segments: run.map(subSegment),
        closed: false,
      },
      startCut: !startsAtCurveStart,
      endCut: !endsAtCurveEnd,
    };
  });
}

function mid(span: Span): number {
  return (span.t0 + span.t1) / 2;
}

// Parameter spans of one segment between its region-boundary crossings.
function splitSegmentAtBoundary(
  from: Vec2,
  segment: PathSegment,
  inRegion: (p: Vec2) => boolean,
): Span[] {
  if (segment.kind === 'elliptical-arc') return [{ from, segment, t0: 0, t1: 1 }];
  const steps = Math.max(2, Math.ceil(approximateLength(from, segment) / SAMPLE_STEP_PX));
  const cuts: number[] = [];
  let previous = inRegion(from);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const inside = inRegion(pointAt(from, segment, t));
    if (inside !== previous) cuts.push(bisect(from, segment, (i - 1) / steps, t, previous, inRegion));
    previous = inside;
  }
  const bounds = [0, ...cuts, 1];
  const spans: Span[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const t0 = bounds[i] ?? 0;
    const t1 = bounds[i + 1] ?? 1;
    if (t1 > t0) spans.push({ from, segment, t0, t1 });
  }
  return spans;
}

function bisect(
  from: Vec2,
  segment: PathSegment,
  lo: number,
  hi: number,
  loInside: boolean,
  inRegion: (p: Vec2) => boolean,
): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < BISECTION_STEPS; i += 1) {
    const m = (a + b) / 2;
    if (inRegion(pointAt(from, segment, m)) === loInside) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

function approximateLength(from: Vec2, segment: PathSegment): number {
  if (segment.kind !== 'cubic') return Math.hypot(segment.to.x - from.x, segment.to.y - from.y);
  return (
    Math.hypot(segment.control1.x - from.x, segment.control1.y - from.y) +
    Math.hypot(segment.control2.x - segment.control1.x, segment.control2.y - segment.control1.y) +
    Math.hypot(segment.to.x - segment.control2.x, segment.to.y - segment.control2.y)
  );
}

function pointAt(from: Vec2, segment: PathSegment, t: number): Vec2 {
  if (segment.kind === 'elliptical-arc') return t < 1 ? from : segment.to;
  if (segment.kind === 'line') return lerp(from, segment.to, t);
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}

// The part of a segment between t0 and t1, starting where the previous
// sub-segment ended.
function subSegment(span: Span): PathSegment {
  const { from, segment, t0, t1 } = span;
  if (segment.kind !== 'cubic') {
    return t1 >= 1 ? segment : { kind: 'line', to: pointAt(from, segment, t1) };
  }
  // Left part [0, t1], then its right part from t0 / t1.
  const left = splitCubic([from, segment.control1, segment.control2, segment.to], t1)[0];
  const part = t0 <= 0 || t1 <= 0 ? left : splitCubic(left, t0 / t1)[1];
  return { kind: 'cubic', control1: part[1], control2: part[2], to: part[3] };
}

type Cubic = readonly [Vec2, Vec2, Vec2, Vec2];

function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t);
  const p12 = lerp(c[1], c[2], t);
  const p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return [
    [c[0], p01, p012, p],
    [p, p123, p23, c[3]],
  ];
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
