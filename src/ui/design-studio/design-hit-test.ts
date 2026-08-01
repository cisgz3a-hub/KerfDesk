// design-hit-test — which entity is under the pointer (ADR-272, DS-3).
//
// Tests against MATERIALIZED geometry, so what you can click is exactly what is
// drawn: an arc is pickable along the arc it sweeps, not across the chord or
// around the rest of its circle.
//
// Picking RANKS candidates rather than taking the first one in z-order, because
// pure z-order plus interior picking makes a later, larger shape swallow every
// shape inside it — the maintainer could not select a square nested in a bigger
// square, which a layered carve (nested rectangles) hits immediately. The rank:
//
//   1. An OUTLINE hit beats any interior hit. An edge you can see beats an
//      interior you cannot, so clicking a small shape's edge picks that shape
//      even when a bigger one covers the point. Nearest edge wins.
//   2. Among interior-only hits, the SMALLEST shape wins — the innermost thing
//      under the pointer, which is what Illustrator and Fusion select.
//   3. Ties go to the topmost, since entity order is z-order.
//
// Tolerance arrives in millimetres (the caller converts from a pixel radius
// through the view) so this stays a pure geometry function.

import { entityBounds, entityToPolylines, type Sketch, type SketchEntity } from '../../core/design';
import { pointInPolygon } from '../../core/geometry';
import type { Polyline, Vec2 } from '../../core/scene';

// Click slop in screen pixels, converted to mm by the caller. Generous enough to
// hit a 1 px line with a trackpad, tight enough not to grab a neighbour.
export const HIT_RADIUS_PX = 6;

export function hitTestSketch(
  sketch: Sketch,
  pointMm: Vec2,
  toleranceMm: number,
): SketchEntity | null {
  // Reverse so the topmost entity is seen first; the strict comparisons in the
  // reducers below then leave ties with it.
  const outlines: Array<{ entity: SketchEntity; rank: number }> = [];
  const interiors: Array<{ entity: SketchEntity; rank: number }> = [];
  for (let index = sketch.entities.length - 1; index >= 0; index -= 1) {
    const entity = sketch.entities[index];
    if (entity === undefined) continue;
    const distanceMm = outlineDistanceMm(entity, pointMm);
    if (distanceMm <= toleranceMm) outlines.push({ entity, rank: distanceMm });
    else if (isInteriorHit(entity, pointMm)) {
      interiors.push({ entity, rank: entityAreaMm2(entity) });
    }
  }
  return lowestRank(outlines) ?? lowestRank(interiors);
}

// First entry wins ties, and the caller pushes topmost-first.
function lowestRank(
  candidates: ReadonlyArray<{ entity: SketchEntity; rank: number }>,
): SketchEntity | null {
  let best: { entity: SketchEntity; rank: number } | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.rank < best.rank) best = candidate;
  }
  return best?.entity ?? null;
}

// Bounding-box area is the innermost-ness measure: exact for the nested
// rectangles a carve is built from, and cheap for everything else.
function entityAreaMm2(entity: SketchEntity): number {
  const bounds = entityBounds(entity);
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function outlineDistanceMm(entity: SketchEntity, pointMm: Vec2): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const polyline of entityToPolylines(entity)) {
    nearest = Math.min(nearest, polylineDistanceMm(polyline, pointMm));
  }
  return nearest;
}

function isInteriorHit(entity: SketchEntity, pointMm: Vec2): boolean {
  for (const polyline of entityToPolylines(entity)) {
    if (isPolylineInteriorHit(polyline, pointMm)) return true;
  }
  return false;
}

export function isEntityHit(entity: SketchEntity, pointMm: Vec2, toleranceMm: number): boolean {
  for (const polyline of entityToPolylines(entity)) {
    if (isPolylineHit(polyline, pointMm, toleranceMm)) return true;
    // A CLOSED shape is also hit anywhere inside it, not just on its outline.
    // Outline-only picking is LightBurn's behaviour, and it is a deliberate
    // divergence (rule 3): the maintainer reported being unable to move shapes,
    // because clicking the middle of a rectangle is ~40 px from any edge and so
    // missed entirely, cleared the selection, and started a marquee instead.
    // Interior picking is what Figma, Illustrator and Fusion all do.
    if (isPolylineInteriorHit(polyline, pointMm)) return true;
  }
  return false;
}

function isPolylineInteriorHit(polyline: Polyline, pointMm: Vec2): boolean {
  if (!polyline.closed || polyline.points.length < 3) return false;
  return pointInPolygon(pointMm, polyline.points);
}

function isPolylineHit(polyline: Polyline, pointMm: Vec2, toleranceMm: number): boolean {
  return polylineDistanceMm(polyline, pointMm) <= toleranceMm;
}

// Distance to the nearest point ON the outline, or Infinity when the polyline
// has no drawable extent. Ranking needs the distance itself, not just whether
// it cleared the tolerance.
function polylineDistanceMm(polyline: Polyline, pointMm: Vec2): number {
  const points = polyline.points;
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) {
    const only = points[0];
    return only === undefined ? Number.POSITIVE_INFINITY : distance(only, pointMm);
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    nearest = Math.min(nearest, distanceToSegment(pointMm, from, to));
  }
  if (!polyline.closed) return nearest;
  const last = points[points.length - 1];
  const first = points[0];
  if (last === undefined || first === undefined) return nearest;
  return Math.min(nearest, distanceToSegment(pointMm, last, first));
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
