// snap-segments — the flat segment list every geometric snap works from
// (ADR-268, Phase N DS-4).
//
// Both the point-on-line snap and the intersection snap need "every straight run
// in the sketch", so it is derived once here rather than twice. Segments come from
// MATERIALIZED geometry, which means an arc contributes only the chords it actually
// sweeps — you can never snap to a part of a circle that is not drawn.

import type { Vec2 } from '../../scene';
import { entityToPolylines } from '../entity-geometry';
import type { Sketch, SketchEntity } from '../sketch-entity';

export type SnapSegment = {
  readonly fromMm: Vec2;
  readonly toMm: Vec2;
  readonly entityId: string;
};

export function entitySegments(entity: SketchEntity): ReadonlyArray<SnapSegment> {
  const segments: SnapSegment[] = [];
  for (const polyline of entityToPolylines(entity)) {
    const points = polyline.points;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (from === undefined || to === undefined) continue;
      segments.push({ fromMm: from, toMm: to, entityId: entity.id });
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (polyline.closed && first !== undefined && last !== undefined && points.length > 2) {
      segments.push({ fromMm: last, toMm: first, entityId: entity.id });
    }
  }
  return segments;
}

export function sketchSegments(
  sketch: Sketch,
  excludeEntityId?: string,
): ReadonlyArray<SnapSegment> {
  return sketch.entities
    .filter((entity) => entity.id !== excludeEntityId)
    .flatMap((entity) => entitySegments(entity));
}

// Nearest point on a segment, clamped to its ends — the point-on-line snap, and
// the distance measure the resolver ranks by.
export function closestPointOnSegment(point: Vec2, segment: SnapSegment): Vec2 {
  const dx = segment.toMm.x - segment.fromMm.x;
  const dy = segment.toMm.y - segment.fromMm.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return segment.fromMm;
  const t = ((point.x - segment.fromMm.x) * dx + (point.y - segment.fromMm.y) * dy) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  return { x: segment.fromMm.x + clamped * dx, y: segment.fromMm.y + clamped * dy };
}

export function distanceMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
