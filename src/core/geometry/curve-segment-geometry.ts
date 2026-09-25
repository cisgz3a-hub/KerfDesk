// curve-segment-geometry — evaluate, sample and split one canonical path
// segment (ADR-159). Node editing inserts, trims and bends on these, so a split
// must leave the drawn shape exactly where it was: cubics split with de
// Casteljau, arcs split on their own ellipse, lines at the parameter.
//
// Pure core — no I/O, no globals, deterministic.

import type {
  CubicPathSegment,
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene';
import { endpointArc, pointOnArc, type CenterArc } from '../scene/curve-path';

const EPSILON = 1e-9;
// A parameter this close to a segment end is that end: splitting there would
// leave a zero-length sliver instead of a node.
export const SEGMENT_PARAMETER_EPSILON = 1e-6;
const QUARTER_TURN = Math.PI / 2;
const MAX_SUBDIVISION_DEPTH = 18;

export type SegmentSample = { readonly t: number; readonly point: Vec2 };

/** The subpath with an implicit closing line written out, so segment `i` always
 *  runs from node `i` to node `i + 1` and the closing edge can be addressed. */
export function explicitCurveSubpath(path: CurveSubpath): CurveSubpath {
  const last = path.segments.at(-1)?.to;
  if (!path.closed || last === undefined || samePoint(last, path.start)) return path;
  return { ...path, segments: [...path.segments, { kind: 'line', to: path.start }] };
}

/** Whether two subpaths have the same nodes and handles, so an edit that
 *  produced one from the other changed nothing worth an undo step. */
export function sameCurveSubpath(a: CurveSubpath, b: CurveSubpath): boolean {
  if (a.closed !== b.closed || a.segments.length !== b.segments.length) return false;
  if (!samePoint(a.start, b.start)) return false;
  return a.segments.every((segment, index) => sameSegment(segment, b.segments[index]));
}

export function segmentStartPoint(path: CurveSubpath, segmentIndex: number): Vec2 | null {
  if (segmentIndex === 0) return path.start;
  return path.segments[segmentIndex - 1]?.to ?? null;
}

export function pointOnSegment(from: Vec2, segment: PathSegment, t: number): Vec2 {
  if (t <= 0) return from;
  if (t >= 1) return segment.to;
  if (segment.kind === 'line') return lerp(from, segment.to, t);
  if (segment.kind === 'cubic') return cubicPoint(from, segment, t);
  const arc = endpointArc(from, segment);
  return arc === null ? lerp(from, segment.to, t) : pointOnArc(arc, arc.theta1 + arc.delta * t);
}

/** Split at `t` into two segments that trace exactly the original. */
export function splitSegment(
  from: Vec2,
  segment: PathSegment,
  t: number,
): readonly [PathSegment, PathSegment] {
  const point = pointOnSegment(from, segment, t);
  if (segment.kind === 'line') return [{ kind: 'line', to: point }, segment];
  if (segment.kind === 'cubic') return splitCubic(from, segment, t);
  const arc = endpointArc(from, segment);
  if (arc === null)
    return [
      { kind: 'line', to: point },
      { kind: 'line', to: segment.to },
    ];
  return [
    arcPiece(segment, arc, arc.delta * t, point),
    arcPiece(segment, arc, arc.delta * (1 - t)),
  ];
}

/** The part of a segment between two parameters, with its own start point.
 *  Parameter ends at 0 and 1 keep the stored end points exactly. */
export function segmentPiece(
  from: Vec2,
  segment: PathSegment,
  t0: number,
  t1: number,
): { readonly from: Vec2; readonly segment: PathSegment } {
  const left = t1 >= 1 ? segment : splitSegment(from, segment, t1)[0];
  if (t0 <= 0) return { from, segment: left };
  const ratio = t1 >= 1 ? t0 : t0 / t1;
  const pieceStart = pointOnSegment(from, left, ratio);
  return { from: pieceStart, segment: splitSegment(from, left, ratio)[1] };
}

/** Parameter-tagged points along the segment, no further than `tolerance`
 *  from it. The first sample is the start (t = 0), the last the end (t = 1). */
export function sampleSegment(
  from: Vec2,
  segment: PathSegment,
  tolerance: number,
): ReadonlyArray<SegmentSample> {
  const safeTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.01;
  const samples: SegmentSample[] = [{ t: 0, point: from }];
  if (segment.kind === 'line') {
    samples.push({ t: 1, point: segment.to });
  } else if (segment.kind === 'cubic') {
    sampleCubic(from, segment, 0, 1, safeTolerance, 0, samples);
  } else {
    sampleArc(from, segment, safeTolerance, samples);
  }
  return samples;
}

/** The parameter a given fraction of the way along the segment by length. */
export function segmentParameterAtLength(
  from: Vec2,
  segment: PathSegment,
  fraction: number,
): number {
  if (segment.kind === 'line') return clamp01(fraction);
  const extent = Math.max(controlExtent(from, segment), EPSILON);
  const samples = sampleSegment(from, segment, extent * 1e-5);
  const lengths = [0];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = (samples[index - 1] as SegmentSample).point;
    const length = distance(previous, (samples[index] as SegmentSample).point);
    lengths.push((lengths[index - 1] as number) + length);
  }
  const target = (lengths.at(-1) ?? 0) * clamp01(fraction);
  for (let index = 1; index < samples.length; index += 1) {
    const end = lengths[index] as number;
    if (end < target) continue;
    const begin = lengths[index - 1] as number;
    const ratio = end > begin ? (target - begin) / (end - begin) : 0;
    const t0 = (samples[index - 1] as SegmentSample).t;
    return t0 + ((samples[index] as SegmentSample).t - t0) * ratio;
  }
  return 1;
}

export function lineAsCubic(from: Vec2, to: Vec2): CubicPathSegment {
  return {
    kind: 'cubic',
    control1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    control2: { x: from.x + (2 * (to.x - from.x)) / 3, y: from.y + (2 * (to.y - from.y)) / 3 },
    to,
  };
}

/** Cubic segments for one segment. An arc becomes one cubic per quarter turn
 *  or less, each with the classic 4/3·tan(θ/4) arms, mapped onto the arc's
 *  ellipse; a single cubic cannot hold a half turn within machine tolerance. */
export function segmentAsCubics(from: Vec2, segment: PathSegment): ReadonlyArray<CubicPathSegment> {
  if (segment.kind === 'cubic') return [segment];
  if (segment.kind === 'line') return [lineAsCubic(from, segment.to)];
  const arc = endpointArc(from, segment);
  if (arc === null) return [lineAsCubic(from, segment.to)];
  const pieces = Math.max(1, Math.ceil(Math.abs(arc.delta) / QUARTER_TURN - EPSILON));
  const step = arc.delta / pieces;
  const arm = (4 / 3) * Math.tan(step / 4);
  return Array.from({ length: pieces }, (_, index) => {
    const a = arc.theta1 + step * index;
    const b = a + step;
    const last = index === pieces - 1;
    return {
      kind: 'cubic' as const,
      control1: onEllipse(arc, Math.cos(a) - arm * Math.sin(a), Math.sin(a) + arm * Math.cos(a)),
      control2: onEllipse(arc, Math.cos(b) + arm * Math.sin(b), Math.sin(b) - arm * Math.cos(b)),
      to: last ? segment.to : pointOnArc(arc, b),
    };
  });
}

function splitCubic(
  from: Vec2,
  segment: CubicPathSegment,
  t: number,
): readonly [CubicPathSegment, CubicPathSegment] {
  const p01 = lerp(from, segment.control1, t);
  const p12 = lerp(segment.control1, segment.control2, t);
  const p23 = lerp(segment.control2, segment.to, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const point = lerp(p012, p123, t);
  return [
    { kind: 'cubic', control1: p01, control2: p012, to: point },
    { kind: 'cubic', control1: p123, control2: p23, to: segment.to },
  ];
}

function arcPiece(
  segment: EllipticalArcPathSegment,
  arc: CenterArc,
  sweepRad: number,
  to: Vec2 = segment.to,
): EllipticalArcPathSegment {
  // The stored radii may be too small to reach both ends (SVG scales them up);
  // each piece carries the reconstructed ellipse so it redraws the same curve.
  return {
    ...segment,
    radiusX: arc.radiusX,
    radiusY: arc.radiusY,
    largeArc: Math.abs(sweepRad) > Math.PI,
    to,
  };
}

function sampleCubic(
  from: Vec2,
  segment: CubicPathSegment,
  t0: number,
  t1: number,
  tolerance: number,
  depth: number,
  out: SegmentSample[],
): void {
  const piece = segmentPiece(from, segment, t0, t1);
  const cubic = piece.segment as CubicPathSegment;
  const flat =
    Math.max(
      pointLineDistance(cubic.control1, piece.from, cubic.to),
      pointLineDistance(cubic.control2, piece.from, cubic.to),
    ) <= tolerance && evenlyParameterized(piece.from, cubic, tolerance);
  if (flat || depth >= MAX_SUBDIVISION_DEPTH) {
    out.push({ t: t1, point: t1 >= 1 ? segment.to : cubic.to });
    return;
  }
  const middle = (t0 + t1) / 2;
  sampleCubic(from, segment, t0, middle, tolerance, depth + 1, out);
  sampleCubic(from, segment, middle, t1, tolerance, depth + 1, out);
}

// Callers read parameters off the chord between samples, so a piece must also
// move along its chord at an even pace: a straight cubic with bunched controls
// is flat yet reaches its chord midpoint far from t = 0.5.
function evenlyParameterized(from: Vec2, cubic: CubicPathSegment, tolerance: number): boolean {
  return [0.25, 0.5, 0.75].every(
    (t) => distance(cubicPoint(from, cubic, t), lerp(from, cubic.to, t)) <= tolerance,
  );
}

function sampleArc(
  from: Vec2,
  segment: EllipticalArcPathSegment,
  tolerance: number,
  out: SegmentSample[],
): void {
  const arc = endpointArc(from, segment);
  if (arc === null) {
    out.push({ t: 1, point: segment.to });
    return;
  }
  const radius = Math.max(arc.radiusX, arc.radiusY);
  const ratio = Math.max(-1, Math.min(1, 1 - tolerance / radius));
  const maxStep = Math.max(1e-6, 2 * Math.acos(ratio));
  const count = Math.max(1, Math.ceil(Math.abs(arc.delta) / maxStep));
  for (let index = 1; index <= count; index += 1) {
    const t = index / count;
    out.push({
      t,
      point: index === count ? segment.to : pointOnArc(arc, arc.theta1 + arc.delta * t),
    });
  }
}

function onEllipse(arc: CenterArc, unitX: number, unitY: number): Vec2 {
  const cos = Math.cos(arc.rotationRad);
  const sin = Math.sin(arc.rotationRad);
  const x = arc.radiusX * unitX;
  const y = arc.radiusY * unitY;
  return { x: arc.center.x + x * cos - y * sin, y: arc.center.y + x * sin + y * cos };
}

function cubicPoint(from: Vec2, segment: CubicPathSegment, t: number): Vec2 {
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

function controlExtent(from: Vec2, segment: PathSegment): number {
  if (segment.kind === 'cubic') {
    return Math.max(
      distance(from, segment.control1),
      distance(from, segment.control2),
      distance(from, segment.to),
    );
  }
  if (segment.kind === 'line') return distance(from, segment.to);
  return Math.max(Math.abs(segment.radiusX), Math.abs(segment.radiusY), distance(from, segment.to));
}

function pointLineDistance(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return distance(point, from);
  return Math.abs(dy * point.x - dx * point.y + to.x * from.y - to.y * from.x) / length;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function sameSegment(a: PathSegment, b: PathSegment | undefined): boolean {
  if (b === undefined || a.kind !== b.kind || !samePoint(a.to, b.to)) return false;
  if (a.kind === 'cubic' && b.kind === 'cubic') {
    return samePoint(a.control1, b.control1) && samePoint(a.control2, b.control2);
  }
  if (a.kind === 'elliptical-arc' && b.kind === 'elliptical-arc') return sameArc(a, b);
  return true;
}

function sameArc(a: EllipticalArcPathSegment, b: EllipticalArcPathSegment): boolean {
  if (a.largeArc !== b.largeArc || a.sweep !== b.sweep) return false;
  return (
    Math.abs(a.radiusX - b.radiusX) <= EPSILON &&
    Math.abs(a.radiusY - b.radiusY) <= EPSILON &&
    Math.abs(a.rotationDeg - b.rotationDeg) <= EPSILON
  );
}
