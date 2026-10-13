// Radius / Fillet on placed artwork (LightBurn Tools > Radius / Fillet), on a
// contour's exact geometry. Only a corner between two straight segments is
// rounded; curves are left as they are.
//   round    replaces the corner with a circular arc of radius r tangent to
//            both lines (the usual fillet).
//   reverse  bites the corner out with an arc of radius r centred on the
//            corner point (a concave, "negative" radius).
//   remove   is the inverse of round: an arc or cubic joining two lines it
//            meets tangentially is replaced by the lines' sharp corner.
// A corner whose lines are too short for the radius is skipped, so applying
// to every corner never produces overlapping arcs.

import type { CurveSubpath, EllipticalArcPathSegment, PathSegment, Vec2 } from '../scene';
import { contourSegments, segmentStart } from './trim-curve-split';

export type FilletMode = 'round' | 'reverse';

const EPS = 1e-9;
const TANGENT_TOLERANCE_RAD = (1 * Math.PI) / 180;
const RADIUS_TOLERANCE = 0.01;

type Corner = { readonly incoming: number; readonly outgoing: number };

/** Number of node positions of the contour, for iterating corners. */
function nodeCount(contour: ReturnType<typeof contourSegments>): number {
  return contour.closed ? contour.segments.length : contour.segments.length + 1;
}

function cornerAt(contour: ReturnType<typeof contourSegments>, node: number): Corner | null {
  const count = contour.segments.length;
  if (contour.closed) return { incoming: (node - 1 + count) % count, outgoing: node % count };
  return node <= 0 || node >= count ? null : { incoming: node - 1, outgoing: node };
}

/**
 * Rounds (or bites) the corners at `nodes` (all corners when omitted). Returns
 * the edited contour and how many corners changed, or null when none did.
 */
export function filletCurveCorners(
  curve: CurveSubpath,
  radius: number,
  mode: FilletMode,
  nodes?: ReadonlyArray<number>,
): { readonly curve: CurveSubpath; readonly count: number } | null {
  if (!(radius > EPS)) return null;
  let contour = contourSegments(curve, curve.closed);
  const all = Array.from({ length: nodeCount(contour) }, (_, index) => index);
  const targets = fittingCorners(contour, [...new Set(nodes ?? all)], radius, mode).sort(
    (a, b) => b - a,
  );
  let count = 0;
  for (const node of targets) {
    const next = filletNode(contour, node, radius, mode);
    if (next === null) continue;
    contour = next;
    count += 1;
  }
  return count === 0 ? null : { curve: { ...contour }, count };
}

type Contour = ReturnType<typeof contourSegments>;

type LineCorner = {
  readonly corner: Corner;
  readonly point: Vec2;
  readonly u: Vec2;
  readonly v: Vec2;
  readonly theta: number;
  readonly inLength: number;
  readonly outLength: number;
};

// The corner at `node` when both its sides are straight and not collinear.
function lineCorner(contour: Contour, node: number): LineCorner | null {
  const corner = cornerAt(contour, node);
  if (corner === null) return null;
  const inSeg = contour.segments[corner.incoming];
  const outSeg = contour.segments[corner.outgoing];
  if (inSeg?.kind !== 'line' || outSeg?.kind !== 'line') return null;
  const toPrev = sub(segmentStart(contour, corner.incoming), inSeg.to);
  const toNext = sub(outSeg.to, inSeg.to);
  const u = unit(toPrev);
  const v = unit(toNext);
  if (u === null || v === null) return null;
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  if (theta < EPS || Math.PI - theta < 1e-6) return null;
  return { corner, point: inSeg.to, u, v, theta, inLength: len(toPrev), outLength: len(toNext) };
}

// How far along each side a corner's arc reaches.
function tangentDistance(corner: LineCorner, radius: number, mode: FilletMode): number {
  return mode === 'round' ? radius / Math.tan(corner.theta / 2) : radius;
}

// A side shared by two rounded corners must hold both arcs; a corner that
// does not fit is left sharp, the same way at both ends, so applying a radius
// to a whole shape stays symmetric.
function fittingCorners(
  contour: Contour,
  nodes: ReadonlyArray<number>,
  radius: number,
  mode: FilletMode,
): number[] {
  const count = nodeCount(contour);
  const claims = new Map<number, { readonly corner: LineCorner; readonly distance: number }>();
  for (const node of nodes) {
    const corner = lineCorner(contour, node);
    if (corner !== null)
      claims.set(node, { corner, distance: tangentDistance(corner, radius, mode) });
  }
  const wrap = (node: number) => (contour.closed ? (node + count) % count : node);
  return [...claims].flatMap(([node, { corner, distance }]) => {
    const before = claims.get(wrap(node - 1))?.distance ?? 0;
    const after = claims.get(wrap(node + 1))?.distance ?? 0;
    const fits =
      distance + before <= corner.inLength + EPS && distance + after <= corner.outLength + EPS;
    return fits ? [node] : [];
  });
}

function filletNode(
  contour: Contour,
  node: number,
  radius: number,
  mode: FilletMode,
): Contour | null {
  const corner = lineCorner(contour, node);
  if (corner === null) return null;
  const distance = tangentDistance(corner, radius, mode);
  if (distance > corner.inLength - EPS || distance > corner.outLength - EPS) return null;
  const { point, u, v, theta } = corner;
  const t1 = add(point, scale(u, distance));
  const t2 = add(point, scale(v, distance));
  const bisector = unit(add(u, v));
  if (bisector === null) return null;
  const center =
    mode === 'round' ? add(point, scale(bisector, radius / Math.sin(theta / 2))) : point;
  const arc: EllipticalArcPathSegment = {
    kind: 'elliptical-arc',
    radiusX: radius,
    radiusY: radius,
    rotationDeg: 0,
    largeArc: false,
    sweep: cross(sub(t1, center), sub(t2, center)) > 0,
    to: t2,
  };
  return replaceCorner(contour, corner.corner, [{ kind: 'line', to: t1 }, arc], t2);
}

/** Replaces each tangent arc or cubic between two lines with the lines' sharp corner. */
export function removeCurveFillets(
  curve: CurveSubpath,
): { readonly curve: CurveSubpath; readonly count: number } | null {
  let contour = contourSegments(curve, curve.closed);
  let count = 0;
  for (let index = contour.segments.length - 1; index >= 0; index -= 1) {
    const next = removeFilletAt(contour, index);
    if (next === null) continue;
    contour = next;
    count += 1;
    index = Math.min(index, contour.segments.length);
  }
  return count === 0 ? null : { curve: { ...contour }, count };
}

type FilletSpan = {
  readonly before: number;
  readonly t1: Vec2;
  readonly t2: Vec2;
  readonly dIn: Vec2;
  readonly dOut: Vec2;
};

// A curve at `index` with a straight side on each end, as a candidate fillet.
function filletSpan(contour: Contour, index: number): FilletSpan | null {
  const count = contour.segments.length;
  const segment = contour.segments[index];
  if (segment === undefined || segment.kind === 'line' || count < 3) return null;
  const before = contour.closed ? (index - 1 + count) % count : index - 1;
  const after = contour.closed ? (index + 1) % count : index + 1;
  const inSeg = contour.segments[before];
  const outSeg = contour.segments[after];
  if (inSeg?.kind !== 'line' || outSeg?.kind !== 'line') return null;
  return tangentSpan(
    segment,
    before,
    segmentStart(contour, before),
    inSeg.to,
    segment.to,
    outSeg.to,
  );
}

function tangentSpan(
  segment: PathSegment,
  before: number,
  a: Vec2,
  t1: Vec2,
  t2: Vec2,
  b: Vec2,
): FilletSpan | null {
  const dIn = unit(sub(t1, a));
  const dOut = unit(sub(b, t2));
  if (dIn === null || dOut === null || !tangentAt(segment, t1, t2, dIn, dOut)) return null;
  return { before, t1, t2, dIn, dOut };
}

function removeFilletAt(contour: Contour, index: number): Contour | null {
  const span = filletSpan(contour, index);
  if (span === null) return null;
  const { before, t1, t2, dIn, dOut } = span;
  const denom = cross(dIn, dOut);
  if (Math.abs(denom) < EPS) return null;
  // The sides meet ahead of the incoming tangent point and behind the outgoing one.
  const s = cross(sub(t2, t1), dOut) / denom;
  const r = cross(sub(t2, t1), dIn) / denom;
  if (s <= 0 || r >= 0) return null;
  const corner = add(t1, scale(dIn, s));
  const last = contour.segments.length - 1;
  const segments = contour.segments
    .map((candidate, at) => (at === before ? { kind: 'line' as const, to: corner } : candidate))
    .filter((_, at) => at !== index);
  const startMoves = contour.closed && (index === last || before === last);
  return { ...contour, start: startMoves ? corner : contour.start, segments };
}
function tangentAt(segment: PathSegment, from: Vec2, to: Vec2, dIn: Vec2, dOut: Vec2): boolean {
  if (segment.kind === 'cubic') {
    const startDir = unit(sub(segment.control1, from));
    const endDir = unit(sub(to, segment.control2));
    return startDir !== null && endDir !== null && aligned(startDir, dIn) && aligned(endDir, dOut);
  }
  if (segment.kind !== 'elliptical-arc' || segment.largeArc) return false;
  // A circular arc tangent to both lines turns by the same angle on each side
  // of its chord, bends the way the lines turn, and has the radius that chord
  // and turn imply: |chord| = 2 R sin(turn).
  const radius = segment.radiusX;
  if (Math.abs(radius - segment.radiusY) > RADIUS_TOLERANCE * radius) return false;
  const chordVector = sub(to, from);
  const chord = unit(chordVector);
  if (chord === null) return false;
  const turnIn = Math.atan2(cross(dIn, chord), dot(dIn, chord));
  const turnOut = Math.atan2(cross(chord, dOut), dot(chord, dOut));
  if (Math.abs(turnIn - turnOut) > TANGENT_TOLERANCE_RAD * 2) return false;
  if (segment.sweep !== turnIn > 0) return false;
  const expected = len(chordVector) / (2 * Math.abs(Math.sin(turnIn)));
  return Math.abs(expected - radius) <= RADIUS_TOLERANCE * radius;
}

function replaceCorner(
  contour: ReturnType<typeof contourSegments>,
  corner: Corner,
  replacement: ReadonlyArray<PathSegment>,
  newCornerEnd: Vec2,
): ReturnType<typeof contourSegments> {
  const segments = [...contour.segments];
  segments.splice(corner.incoming, 1, ...replacement);
  if (corner.outgoing === 0 && contour.closed) {
    // The corner is the contour's start: it now begins where the arc ends.
    return { ...contour, start: newCornerEnd, segments };
  }
  return { ...contour, segments };
}

function aligned(a: Vec2, b: Vec2): boolean {
  return Math.abs(Math.atan2(cross(a, b), dot(a, b))) <= TANGENT_TOLERANCE_RAD;
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const len = (a: Vec2): number => Math.hypot(a.x, a.y);

function unit(a: Vec2): Vec2 | null {
  const length = len(a);
  return length < EPS ? null : { x: a.x / length, y: a.y / length };
}
