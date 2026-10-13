// Measure (LightBurn Tools > Measure): inspect one segment and the whole
// outline of placed artwork. Everything is in world millimetres, after the
// object's transform. Segment and perimeter lengths sample the exact curve;
// area counts only closed contours, with even-odd nesting (a hole subtracts,
// an island inside it adds back), so open paths are reported, never guessed.

import { endpointArc } from '../scene/curve-path';
import {
  applyTransform,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../scene';
import { contourSegments, segmentPoint, segmentStart } from './trim-curve-split';

const CURVE_SAMPLES = 64;
const UNIFORM_SCALE_TOLERANCE = 1e-9;

export type SegmentMeasure =
  | {
      readonly kind: 'line';
      readonly lengthMm: number;
      readonly angleDeg: number;
      readonly start: Vec2;
      readonly end: Vec2;
    }
  | { readonly kind: 'curve'; readonly lengthMm: number; readonly start: Vec2; readonly end: Vec2 }
  | {
      readonly kind: 'arc';
      readonly lengthMm: number;
      readonly start: Vec2;
      readonly end: Vec2;
      readonly center: Vec2;
      /** Null for an elliptical arc, or a circular arc under unequal scaling. */
      readonly radiusMm: number | null;
    };

export type OutlineMeasure = {
  readonly perimeterMm: number;
  /** Enclosed area of the closed contours; null when there are none. */
  readonly areaMm2: number | null;
  readonly closedContours: number;
  readonly openContours: number;
};

export function measureSegment(
  curve: CurveSubpath,
  segmentIndex: number,
  transform: Transform,
): SegmentMeasure | null {
  const contour = contourSegments(curve, curve.closed);
  const segment = contour.segments[segmentIndex];
  if (segment === undefined) return null;
  const from = segmentStart(contour, segmentIndex);
  const world = (point: Vec2) => applyTransform(point, transform);
  const start = world(from);
  const end = world(segment.to);
  if (segment.kind === 'line') {
    const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
    return {
      kind: 'line',
      lengthMm: Math.hypot(end.x - start.x, end.y - start.y),
      angleDeg: angle < 0 ? angle + 360 : angle,
      start,
      end,
    };
  }
  const lengthMm = polylineLength(sampleSegment(from, segment, transform));
  const arc = segment.kind === 'elliptical-arc' ? endpointArc(from, segment) : null;
  if (arc === null) return { kind: 'curve', lengthMm, start, end };
  const uniform =
    Math.abs(Math.abs(transform.scaleX) - Math.abs(transform.scaleY)) <= UNIFORM_SCALE_TOLERANCE;
  const circular = Math.abs(arc.radiusX - arc.radiusY) <= UNIFORM_SCALE_TOLERANCE * arc.radiusX;
  return {
    kind: 'arc',
    lengthMm,
    start,
    end,
    center: world(arc.center),
    radiusMm: uniform && circular ? arc.radiusX * Math.abs(transform.scaleX) : null,
  };
}

export function measureOutline(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
): OutlineMeasure {
  let perimeterMm = 0;
  let openContours = 0;
  const rings: Vec2[][] = [];
  for (const path of paths) {
    for (const curve of path.curves ?? path.polylines.map(polylineToCurveSubpath)) {
      const points = sampleContour(curve, transform);
      if (points.length < 2) continue;
      perimeterMm += polylineLength(points);
      if (curve.closed && points.length >= 3) rings.push(points);
      else openContours += 1;
    }
  }
  return {
    perimeterMm,
    areaMm2: rings.length === 0 ? null : evenOddArea(rings),
    closedContours: rings.length,
    openContours,
  };
}

function sampleContour(curve: CurveSubpath, transform: Transform): Vec2[] {
  const contour = contourSegments(curve, curve.closed);
  const points = [applyTransform(contour.start, transform)];
  contour.segments.forEach((segment, index) => {
    points.push(...sampleSegment(segmentStart(contour, index), segment, transform).slice(1));
  });
  return points;
}

function sampleSegment(
  from: Vec2,
  segment: CurveSubpath['segments'][number],
  transform: Transform,
): Vec2[] {
  const steps = segment.kind === 'line' ? 1 : CURVE_SAMPLES;
  const points: Vec2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    points.push(applyTransform(segmentPoint(from, segment, step / steps), transform));
  }
  return points;
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function evenOddArea(rings: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  return rings.reduce((total, ring, index) => {
    const probe = ring[0] as Vec2;
    const depth = rings.filter((other, j) => j !== index && pointInRing(probe, other)).length;
    const area = Math.abs(signedArea(ring));
    return total + (depth % 2 === 0 ? area : -area);
  }, 0);
}

function signedArea(ring: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index] as Vec2;
    const b = ring[(index + 1) % ring.length] as Vec2;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function pointInRing(point: Vec2, ring: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}
