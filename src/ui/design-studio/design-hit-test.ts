// design-hit-test — which entity is under the pointer (ADR-268, DS-3).
//
// Tests against MATERIALIZED geometry, so what you can click is exactly what is
// drawn: an arc is pickable along the arc it sweeps, not across the chord or
// around the rest of its circle.
//
// Topmost-first, because entity order is z-order and the thing drawn last is the
// thing the operator sees. Tolerance arrives in millimetres (the caller converts
// from a pixel radius through the view) so this stays a pure geometry function.

import { entityToPolylines, type Sketch, type SketchEntity } from '../../core/design';
import type { Polyline, Vec2 } from '../../core/scene';

// Click slop in screen pixels, converted to mm by the caller. Generous enough to
// hit a 1 px line with a trackpad, tight enough not to grab a neighbour.
export const HIT_RADIUS_PX = 6;

export function hitTestSketch(
  sketch: Sketch,
  pointMm: Vec2,
  toleranceMm: number,
): SketchEntity | null {
  // Reverse: topmost entity wins.
  for (let index = sketch.entities.length - 1; index >= 0; index -= 1) {
    const entity = sketch.entities[index];
    if (entity === undefined) continue;
    if (isEntityHit(entity, pointMm, toleranceMm)) return entity;
  }
  return null;
}

export function isEntityHit(entity: SketchEntity, pointMm: Vec2, toleranceMm: number): boolean {
  for (const polyline of entityToPolylines(entity)) {
    if (isPolylineHit(polyline, pointMm, toleranceMm)) return true;
  }
  return false;
}

function isPolylineHit(polyline: Polyline, pointMm: Vec2, toleranceMm: number): boolean {
  const points = polyline.points;
  if (points.length === 0) return false;
  if (points.length === 1) {
    const only = points[0];
    return only !== undefined && distance(only, pointMm) <= toleranceMm;
  }
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    if (distanceToSegment(pointMm, from, to) <= toleranceMm) return true;
  }
  if (!polyline.closed) return false;
  const last = points[points.length - 1];
  const first = points[0];
  if (last === undefined || first === undefined) return false;
  return distanceToSegment(pointMm, last, first) <= toleranceMm;
}

// Perpendicular distance to the segment, clamped to the segment's ends.
export function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(from, point);
  const t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, t));
  return distance({ x: from.x + clamped * dx, y: from.y + clamped * dy }, point);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Every entity whose materialized geometry falls entirely inside the rectangle —
// the marquee rule (enclose, not touch), matching the main workspace.
export function entitiesInRectMm(
  sketch: Sketch,
  cornerAMm: Vec2,
  cornerBMm: Vec2,
): ReadonlyArray<SketchEntity> {
  const minX = Math.min(cornerAMm.x, cornerBMm.x);
  const maxX = Math.max(cornerAMm.x, cornerBMm.x);
  const minY = Math.min(cornerAMm.y, cornerBMm.y);
  const maxY = Math.max(cornerAMm.y, cornerBMm.y);
  return sketch.entities.filter((entity) => {
    const polylines = entityToPolylines(entity);
    if (polylines.length === 0) return false;
    return polylines.every((polyline) =>
      polyline.points.every(
        (point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY,
      ),
    );
  });
}
