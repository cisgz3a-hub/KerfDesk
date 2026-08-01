// scale-entities — resize geometry about a fixed anchor (ADR-272, DS-8d).
//
// Uniform, and exact for every entity kind: one factor scales a circle to a
// circle and an arc to an arc, so a corner grip never changes what a shape IS.
//
// Per-axis stretching is a different operation with different exactness rules
// and lives in stretch-entities (ADR-272 Amendment 4). Keeping them apart is
// deliberate: a corner grip must never quietly bake an arc.

import type { Vec2 } from '../../scene';
import type { Sketch, SketchEntity } from '../sketch-entity';

// Below this the drag has collapsed the selection to nothing; the sketch is
// returned unchanged rather than baking in a degenerate shape.
export const MIN_SCALE_FACTOR = 0.001;

export function scaleEntity(entity: SketchEntity, anchorMm: Vec2, factor: number): SketchEntity {
  const about = (point: Vec2): Vec2 => ({
    x: anchorMm.x + (point.x - anchorMm.x) * factor,
    y: anchorMm.y + (point.y - anchorMm.y) * factor,
  });
  switch (entity.kind) {
    case 'rect':
      return {
        ...entity,
        origin: about(entity.origin),
        widthMm: entity.widthMm * factor,
        heightMm: entity.heightMm * factor,
        cornerRadiusMm: entity.cornerRadiusMm * factor,
      };
    case 'circle':
      return { ...entity, center: about(entity.center), radiusMm: entity.radiusMm * factor };
    case 'ellipse':
      return {
        ...entity,
        center: about(entity.center),
        radiusXMm: entity.radiusXMm * factor,
        radiusYMm: entity.radiusYMm * factor,
      };
    case 'arc':
      // Sweep and start angle are unchanged: scaling about a point preserves
      // direction, so only the radius and the centre move.
      return { ...entity, center: about(entity.center), radiusMm: entity.radiusMm * factor };
    case 'line':
      return { ...entity, start: about(entity.start), end: about(entity.end) };
    case 'path':
      return { ...entity, points: entity.points.map(about) };
  }
}

/**
 * Scales every entity named in `ids` by `factor` about `anchorMm`.
 *
 * A factor of exactly 1, a non-finite or non-positive factor, an empty id set,
 * or ids that match nothing all return the SAME sketch object, so a resize
 * gesture that has not moved yet costs nothing and cannot be mistaken for a
 * change.
 */
export function scaleEntities(
  sketch: Sketch,
  ids: ReadonlySet<string>,
  anchorMm: Vec2,
  factor: number,
): Sketch {
  if (ids.size === 0 || factor === 1) return sketch;
  if (!Number.isFinite(factor) || factor < MIN_SCALE_FACTOR) return sketch;
  if (!Number.isFinite(anchorMm.x) || !Number.isFinite(anchorMm.y)) return sketch;
  let changed = false;
  const entities = sketch.entities.map((entity) => {
    if (!ids.has(entity.id)) return entity;
    changed = true;
    return scaleEntity(entity, anchorMm, factor);
  });
  return changed ? { ...sketch, entities } : sketch;
}
