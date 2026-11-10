// deferred-snaps — tangent and perpendicular snap targets (ADR-272 Amendment 6,
// Phase N DS-4b).
//
// AutoCAD calls these DEFERRED snaps because neither exists on its own: a
// tangent point or a perpendicular foot is only defined relative to the point
// the gesture started from. Given that point, each is computed exactly from the
// entity's own definition - a circle's tangent points from its centre and
// radius, a line's foot by projection - never from the sampled chords, so a
// line drawn to a tangent snap really is tangent.
//
// Perpendicular to a circle or arc is the radial point (nearest and farthest),
// which is also what makes a circle drawn from a centre touch another circle.
// An ellipse offers neither: its tangent points need an iterative solve the
// Studio does not carry, and a wrong tangent is worse than none.

import type { Vec2 } from '../../scene';
import type { SketchArc, SketchCircle, SketchEntity } from '../sketch-entity';
import type { SnapTarget } from './snap-kinds';
import { entitySegments, type SnapSegment } from './snap-segments';

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_RAD = Math.PI * 2;
// A from-point this close to a centre has no meaningful radial direction.
const CENTRE_EPSILON_MM = 1e-9;

export function deferredSnapTargets(
  entities: ReadonlyArray<SketchEntity>,
  fromMm: Vec2,
): ReadonlyArray<SnapTarget> {
  return entities.flatMap((entity) => entityDeferredTargets(entity, fromMm));
}

function entityDeferredTargets(entity: SketchEntity, fromMm: Vec2): ReadonlyArray<SnapTarget> {
  switch (entity.kind) {
    case 'circle':
    case 'arc':
      return roundTargets(entity, fromMm);
    case 'ellipse':
      return [];
    case 'rect':
      // A rounded corner's straight runs still take a foot; the sampled corner
      // chords would only give approximate feet, so they are left out.
      return straightFeet(entity.cornerRadiusMm > 0 ? [] : entitySegments(entity), fromMm);
    case 'line':
    case 'path':
      return straightFeet(entitySegments(entity), fromMm);
  }
}

function straightFeet(segments: ReadonlyArray<SnapSegment>, fromMm: Vec2): SnapTarget[] {
  const feet: SnapTarget[] = [];
  for (const segment of segments) {
    const foot = perpendicularFoot(fromMm, segment);
    if (foot !== null) feet.push({ kind: 'perpendicular', atMm: foot, entityId: segment.entityId });
  }
  return feet;
}

/** The foot of the perpendicular from `point` to the segment, or null when it falls outside it. */
export function perpendicularFoot(point: Vec2, segment: SnapSegment): Vec2 | null {
  const dx = segment.toMm.x - segment.fromMm.x;
  const dy = segment.toMm.y - segment.fromMm.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return null;
  const t = ((point.x - segment.fromMm.x) * dx + (point.y - segment.fromMm.y) * dy) / lengthSquared;
  if (t < 0 || t > 1) return null;
  return { x: segment.fromMm.x + t * dx, y: segment.fromMm.y + t * dy };
}

function roundTargets(entity: SketchCircle | SketchArc, fromMm: Vec2): SnapTarget[] {
  const { center, radiusMm } = entity;
  const dx = fromMm.x - center.x;
  const dy = fromMm.y - center.y;
  const reach = Math.hypot(dx, dy);
  if (reach < CENTRE_EPSILON_MM) return [];
  const toward = Math.atan2(dy, dx);
  const angles: Array<{ kind: 'tangent' | 'perpendicular'; rad: number }> = [
    { kind: 'perpendicular', rad: toward },
    { kind: 'perpendicular', rad: toward + Math.PI },
  ];
  // Tangent points exist only from outside the rim: the tangent from P touches
  // where the radius meets the line to P at a right angle, acos(r / |PC|) off
  // the centre-to-P direction.
  if (reach > radiusMm) {
    const spread = Math.acos(radiusMm / reach);
    angles.push(
      { kind: 'tangent', rad: toward + spread },
      { kind: 'tangent', rad: toward - spread },
    );
  }
  return angles
    .filter(({ rad }) => entity.kind === 'circle' || onArcSweep(entity, rad))
    .map(({ kind, rad }) => ({
      kind,
      atMm: { x: center.x + Math.cos(rad) * radiusMm, y: center.y + Math.sin(rad) * radiusMm },
      entityId: entity.id,
    }));
}

/** True when the direction `rad` from the centre lies on the arc's drawn sweep. */
export function onArcSweep(arc: SketchArc, rad: number): boolean {
  const start = arc.startAngleDeg * DEG_TO_RAD;
  const sweep = arc.sweepDeg * DEG_TO_RAD;
  if (Math.abs(sweep) >= FULL_TURN_RAD) return true;
  const offset = sweep >= 0 ? rad - start : start - rad;
  const wrapped = ((offset % FULL_TURN_RAD) + FULL_TURN_RAD) % FULL_TURN_RAD;
  return wrapped <= Math.abs(sweep) + 1e-12;
}
