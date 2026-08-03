import type { Vec3 } from '../geometry/vec3';
import type { Polyline, Vec2 } from '../scene';
import { emittedChordIsSafe } from './vcarve-detail-chord-safety';
import {
  EMIT_COORDINATE_QUANTUM_MM,
  emittedPoint,
  emitXyKey,
  pointToSegmentDistance,
  samePoint,
  segmentToSegmentDistance,
  type BoundarySegment,
} from './vcarve-detail-geometry';
import { validDepthInputs, validDepthTolerance, type DetailDepthLaw } from './vcarve-detail-input';

export type { BoundarySegment } from './vcarve-detail-geometry';
export type { DetailDepthLaw } from './vcarve-detail-input';
export { sourceBoundarySegments } from './vcarve-detail-boundary';
export { emittedChordIsSafe } from './vcarve-detail-chord-safety';

export type DetailPath3dPlan = {
  readonly points: ReadonlyArray<Vec3>;
  readonly toleranceMet: boolean;
};

const DEFAULT_Z_TOLERANCE_MM = 0.02;
const MIN_REFINEMENT_SPAN_MM = 0.001;
const MAX_ADDED_REFINEMENTS = 8_192;
const QUALITY_EPSILON_MM = 1e-12;

type DepthLeaf = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly depthA: number;
  readonly depthB: number;
};

type RefinementState = {
  remaining: number;
  toleranceMet: boolean;
};

type MutableVec3 = { x: number; y: number; z: number };

export function detailPath3dPoints(
  polyline: Polyline,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): ReadonlyArray<Vec3> {
  return detailPath3dPlan(polyline, segments, law).points;
}

export function vcarveEmittedDepthAtPoint(
  point: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): number {
  return emittedSafeDepth(emittedPoint(point), segments, law);
}

/**
 * Build a variable-Z path whose emitted 0.001 mm XYZ chords stay inside the
 * analytic V envelope. Each chord is checked against every original boundary
 * segment. Refinement is quality-only and bounded; if the requested tolerance
 * cannot be represented, the affected chord becomes a conservative shallower
 * constant-depth chord and the caller receives toleranceMet=false.
 */
export function detailPath3dPlan(
  polyline: Polyline,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
  zToleranceMm = DEFAULT_Z_TOLERANCE_MM,
): DetailPath3dPlan {
  const path = pathPoints(polyline);
  if (!validDepthInputs(path, segments, law)) return { points: [], toleranceMet: false };
  const toleranceMm = validDepthTolerance(zToleranceMm, DEFAULT_Z_TOLERANCE_MM);
  const state: RefinementState = { remaining: MAX_ADDED_REFINEMENTS, toleranceMet: true };
  const leaves: DepthLeaf[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    if (a !== undefined && b !== undefined) {
      leaves.push(...refineDepthSpan(a, b, segments, law, toleranceMm, state));
    }
  }
  const collapsed = collapseAtEmitPrecision(pointsForLeaves(leaves), polyline.closed);
  return {
    points: collapsed.points,
    toleranceMet: state.toleranceMet && !collapsed.changed,
  };
}

function refineDepthSpan(
  a: Vec2,
  b: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
  toleranceMm: number,
  state: RefinementState,
): ReadonlyArray<DepthLeaf> {
  const leaves: DepthLeaf[] = [];
  const pending: Array<{ readonly a: Vec2; readonly b: Vec2 }> = [{ a, b }];
  while (pending.length > 0) {
    const span = pending.pop();
    if (span === undefined) continue;
    const planned = plannedLeaf(span.a, span.b, segments, law);
    if (planned.safe && depthQualityMet(planned.leaf, segments, law, toleranceMm)) {
      leaves.push(planned.leaf);
      continue;
    }
    if (canRefine(span.a, span.b, state)) {
      const midpoint = { x: (span.a.x + span.b.x) / 2, y: (span.a.y + span.b.y) / 2 };
      state.remaining -= 1;
      pending.push({ a: midpoint, b: span.b }, { a: span.a, b: midpoint });
      continue;
    }
    state.toleranceMet = false;
    leaves.push(conservativeLeaf(span.a, span.b, segments, law));
  }
  return leaves;
}

function plannedLeaf(
  rawA: Vec2,
  rawB: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): { readonly leaf: DepthLeaf; readonly safe: boolean } {
  const a = emittedPoint(rawA);
  const b = emittedPoint(rawB);
  const leaf = {
    a: rawA,
    b: rawB,
    depthA: emittedSafeDepth(a, segments, law),
    depthB: emittedSafeDepth(b, segments, law),
  };
  return {
    leaf,
    safe: emittedChordIsSafe(a, b, leaf.depthA, leaf.depthB, segments, law.tanHalf),
  };
}

function conservativeLeaf(
  rawA: Vec2,
  rawB: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): DepthLeaf {
  const a = emittedPoint(rawA);
  const b = emittedPoint(rawB);
  let clearanceMm = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    clearanceMm = Math.min(clearanceMm, segmentToSegmentDistance(a, b, segment));
  }
  const boundaryDepthMm = clearanceMm / law.tanHalf;
  const depth = quantizeDepth(
    Math.min(boundaryDepthMm, law.maxDepthMm),
    boundaryDepthMm > law.maxDepthMm + 1e-9,
  );
  return { a: rawA, b: rawB, depthA: depth, depthB: depth };
}

function depthQualityMet(
  leaf: DepthLeaf,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
  toleranceMm: number,
): boolean {
  const a = emittedPoint(leaf.a);
  const b = emittedPoint(leaf.b);
  if (Math.min(leaf.depthA, leaf.depthB) + toleranceMm >= law.maxDepthMm) return true;
  const radiusA = (leaf.depthA + toleranceMm) * law.tanHalf;
  const radiusB = (leaf.depthB + toleranceMm) * law.tanHalf;
  // Distance to one closed segment is convex along this chord, while the
  // allowed radius interpolates linearly. If one boundary segment is within
  // the allowed radius at both endpoints, convexity certifies the whole span.
  // Requiring the same segment catches a narrow peak hidden between samples.
  return segments.some(
    (segment) =>
      pointToSegmentDistance(a.x, a.y, segment) <= radiusA + QUALITY_EPSILON_MM &&
      pointToSegmentDistance(b.x, b.y, segment) <= radiusB + QUALITY_EPSILON_MM,
  );
}

function emittedSafeDepth(
  point: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): number {
  let distanceMm = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    distanceMm = Math.min(distanceMm, pointToSegmentDistance(point.x, point.y, segment));
  }
  const boundaryDepthMm = distanceMm / law.tanHalf;
  return quantizeDepth(
    Math.min(boundaryDepthMm, law.maxDepthMm),
    boundaryDepthMm > law.maxDepthMm + 1e-9,
  );
}

function quantizeDepth(depthMm: number, safelyCapLimited: boolean): number {
  if (!(depthMm > 0) || !Number.isFinite(depthMm)) return 0;
  const epsilon = safelyCapLimited ? 1e-12 : -1e-12;
  return Math.max(
    0,
    Math.floor((depthMm + epsilon) / EMIT_COORDINATE_QUANTUM_MM) * EMIT_COORDINATE_QUANTUM_MM,
  );
}

function canRefine(a: Vec2, b: Vec2, state: RefinementState): boolean {
  if (state.remaining <= 0) return false;
  const lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
  if (lengthMm <= MIN_REFINEMENT_SPAN_MM) return false;
  const midpoint = emittedPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const emittedA = emittedPoint(a);
  const emittedB = emittedPoint(b);
  return !samePoint(midpoint, emittedA) && !samePoint(midpoint, emittedB);
}

function pointsForLeaves(leaves: ReadonlyArray<DepthLeaf>): ReadonlyArray<Vec3> {
  const points: MutableVec3[] = [];
  for (const leaf of leaves) {
    appendDepthPoint(points, leaf.a, leaf.depthA);
    appendDepthPoint(points, leaf.b, leaf.depthB);
  }
  return points;
}

function appendDepthPoint(points: MutableVec3[], point: Vec2, depthMm: number): void {
  const emitted = emittedPoint(point);
  const previous = points.at(-1);
  if (previous !== undefined && emitXyKey(previous) === emitXyKey(emitted)) {
    previous.z = Math.max(previous.z, -depthMm);
    return;
  }
  points.push({ x: emitted.x, y: emitted.y, z: -depthMm });
}

function collapseAtEmitPrecision(
  points: ReadonlyArray<Vec3>,
  closed: boolean,
): { readonly points: ReadonlyArray<Vec3>; readonly changed: boolean } {
  const out: MutableVec3[] = [];
  let changed = false;
  for (const point of points) {
    const previous = out.at(-1);
    if (previous !== undefined && emitXyKey(previous) === emitXyKey(point)) {
      previous.z = Math.max(previous.z, point.z);
      changed = true;
    } else {
      out.push({ ...point });
    }
  }
  if (closed && out.length > 1) closeEmittedPath(out);
  return { points: out, changed };
}

function closeEmittedPath(points: MutableVec3[]): void {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return;
  if (emitXyKey(first) === emitXyKey(last)) {
    const shallowZ = Math.max(first.z, last.z);
    first.z = shallowZ;
    last.z = shallowZ;
  } else {
    points.push({ ...first });
  }
}

function pathPoints(polyline: Polyline): ReadonlyArray<Vec2> {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  if (!polyline.closed || first === undefined || last === undefined || samePoint(first, last)) {
    return polyline.points;
  }
  return [...polyline.points, first];
}
