// trim-crossings — where one entity is crossed by the others (ADR-272
// Amendment 8, Phase N DS-6c Trim).
//
// Every cutting edge is reduced to exact primitives - straight segments and
// circular arcs - so a crossing is solved analytically, the same standard
// extend-boundaries.ts holds: a rectangle is four edges plus, when rounded,
// four quarter arcs; a circle is one full arc. An ellipse is the one boundary
// taken from its sampled outline (at the shared chord tolerance), because a
// segment-ellipse or arc-ellipse crossing has no closed form the Studio
// carries; the cut lands on the drawn outline, not the ideal curve.

import type { Vec2 } from '../../scene';
import { entityToPolylines } from '../entity-geometry';
import type { SketchEntity } from '../sketch-entity';

export const TRIM_EPS_MM = 1e-7;
const FULL_TURN_DEG = 360;
const RAD_TO_DEG = 180 / Math.PI;

export type TrimSegment = { readonly kind: 'segment'; readonly a: Vec2; readonly b: Vec2 };
export type TrimArc = {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radius: number;
  readonly startDeg: number;
  // Signed; |sweep| = 360 is a full circle.
  readonly sweepDeg: number;
};
export type TrimPrimitive = TrimSegment | TrimArc;

/** The exact pieces a cutting edge is made of. */
export function entityPrimitives(entity: SketchEntity): ReadonlyArray<TrimPrimitive> {
  switch (entity.kind) {
    case 'line':
      return [{ kind: 'segment', a: entity.start, b: entity.end }];
    case 'path':
      return chainSegments(entity.points, entity.closed);
    case 'circle':
      return [fullCircle(entity.center, entity.radiusMm)];
    case 'arc':
      return [
        {
          kind: 'arc',
          center: entity.center,
          radius: entity.radiusMm,
          startDeg: entity.startAngleDeg,
          sweepDeg: entity.sweepDeg,
        },
      ];
    case 'rect':
      return rectPrimitives(entity);
    case 'ellipse':
      return entityToPolylines(entity).flatMap((polyline) =>
        chainSegments(polyline.points, polyline.closed),
      );
  }
}

export function chainSegments(points: ReadonlyArray<Vec2>, closed: boolean): TrimSegment[] {
  const segments: TrimSegment[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a !== undefined && b !== undefined) segments.push({ kind: 'segment', a, b });
  }
  return segments;
}

export function fullCircle(center: Vec2, radius: number): TrimArc {
  return { kind: 'arc', center, radius, startDeg: 0, sweepDeg: FULL_TURN_DEG };
}

/** Crossing parameters along a segment, as fractions 0..1 of its length. */
export function segmentCrossings(segment: TrimSegment, other: TrimPrimitive): number[] {
  return other.kind === 'segment'
    ? segmentSegment(segment, other)
    : segmentCircle(segment, other)
        .filter(({ angle }) => onArc(other, angle))
        .map(({ t }) => t);
}

/** Crossing angles (degrees) on a circle, against one primitive. */
export function circleCrossings(circle: TrimArc, other: TrimPrimitive): number[] {
  if (other.kind === 'segment') {
    return segmentCircle(other, circle).map(({ angle }) => angle);
  }
  return circleCircle(circle, other)
    .filter((point) => onArc(other, angleOf(other.center, point)))
    .map((point) => angleOf(circle.center, point));
}

function segmentSegment(segment: TrimSegment, other: TrimSegment): number[] {
  const r = { x: segment.b.x - segment.a.x, y: segment.b.y - segment.a.y };
  const s = { x: other.b.x - other.a.x, y: other.b.y - other.a.y };
  const denominator = r.x * s.y - r.y * s.x;
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  // Collinear overlaps are not crossings: there is no single point to cut at.
  if (scale === 0 || Math.abs(denominator) <= 1e-12 * scale) return [];
  const q = { x: other.a.x - segment.a.x, y: other.a.y - segment.a.y };
  const t = (q.x * s.y - q.y * s.x) / denominator;
  const u = (q.x * r.y - q.y * r.x) / denominator;
  const marginT = TRIM_EPS_MM / Math.hypot(r.x, r.y);
  const marginU = TRIM_EPS_MM / Math.hypot(s.x, s.y);
  if (t < -marginT || t > 1 + marginT || u < -marginU || u > 1 + marginU) return [];
  return [Math.min(1, Math.max(0, t))];
}

function segmentCircle(
  segment: TrimSegment,
  circle: TrimArc,
): Array<{ readonly t: number; readonly angle: number }> {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const fx = segment.a.x - circle.center.x;
  const fy = segment.a.y - circle.center.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - circle.radius * circle.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const margin = TRIM_EPS_MM / Math.sqrt(a);
  const roots =
    discriminant === 0 ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  return roots
    .filter((t) => t >= -margin && t <= 1 + margin)
    .map((t) => {
      const clamped = Math.min(1, Math.max(0, t));
      const point = { x: segment.a.x + dx * clamped, y: segment.a.y + dy * clamped };
      return { t: clamped, angle: angleOf(circle.center, point) };
    });
}

function circleCircle(first: TrimArc, second: TrimArc): Vec2[] {
  const dx = second.center.x - first.center.x;
  const dy = second.center.y - first.center.y;
  const d = Math.hypot(dx, dy);
  // Concentric circles never cross at a point (coincident ones overlap).
  if (d <= TRIM_EPS_MM) return [];
  if (d > first.radius + second.radius + TRIM_EPS_MM) return [];
  if (d < Math.abs(first.radius - second.radius) - TRIM_EPS_MM) return [];
  const along = (first.radius * first.radius - second.radius * second.radius + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, first.radius * first.radius - along * along));
  const mid = { x: first.center.x + (dx * along) / d, y: first.center.y + (dy * along) / d };
  if (h <= TRIM_EPS_MM) return [mid];
  return [
    { x: mid.x - (dy * h) / d, y: mid.y + (dx * h) / d },
    { x: mid.x + (dy * h) / d, y: mid.y - (dx * h) / d },
  ];
}

/** True when the direction `angleDeg` from the arc's centre lies on its drawn sweep. */
export function onArc(arc: TrimArc, angleDeg: number): boolean {
  if (Math.abs(arc.sweepDeg) >= FULL_TURN_DEG) return true;
  const progress = modulo(arc.sweepDeg < 0 ? arc.startDeg - angleDeg : angleDeg - arc.startDeg);
  const tolerance = (TRIM_EPS_MM / arc.radius) * RAD_TO_DEG;
  return progress <= Math.abs(arc.sweepDeg) + tolerance || FULL_TURN_DEG - progress <= tolerance;
}

export function angleOf(center: Vec2, point: Vec2): number {
  return modulo(Math.atan2(point.y - center.y, point.x - center.x) * RAD_TO_DEG);
}

export function modulo(degrees: number): number {
  return ((degrees % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
}

function rectPrimitives(rect: Extract<SketchEntity, { readonly kind: 'rect' }>): TrimPrimitive[] {
  const { x, y } = rect.origin;
  const right = x + rect.widthMm;
  const top = y + rect.heightMm;
  const r = Math.min(rect.cornerRadiusMm, rect.widthMm / 2, rect.heightMm / 2);
  const edges: TrimPrimitive[] = [
    { kind: 'segment', a: { x: x + r, y }, b: { x: right - r, y } },
    { kind: 'segment', a: { x: right, y: y + r }, b: { x: right, y: top - r } },
    { kind: 'segment', a: { x: right - r, y: top }, b: { x: x + r, y: top } },
    { kind: 'segment', a: { x, y: top - r }, b: { x, y: y + r } },
  ];
  if (r <= 0) return edges;
  return edges.concat([
    { kind: 'arc', center: { x: right - r, y: top - r }, radius: r, startDeg: 0, sweepDeg: 90 },
    { kind: 'arc', center: { x: x + r, y: top - r }, radius: r, startDeg: 90, sweepDeg: 90 },
    { kind: 'arc', center: { x: x + r, y: y + r }, radius: r, startDeg: 180, sweepDeg: 90 },
    { kind: 'arc', center: { x: right - r, y: y + r }, radius: r, startDeg: 270, sweepDeg: 90 },
  ]);
}
