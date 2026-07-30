// translate-entities — move geometry (ADR-268, DS-6c).
//
// Every entity kind carries its position differently — a rect has an origin, a
// circle and an arc a centre, a line two endpoints, a path a point list — so moving
// a mixed selection needs one place that knows all of them. Without it, "drag the
// thing you just drew" is impossible, which made the Studio unusable no matter how
// precise its dimensions were.

import type { Vec2 } from '../../scene';
import type { Sketch, SketchEntity } from '../sketch-entity';

export function translateEntity(entity: SketchEntity, deltaMm: Vec2): SketchEntity {
  const shift = (point: Vec2): Vec2 => ({ x: point.x + deltaMm.x, y: point.y + deltaMm.y });
  switch (entity.kind) {
    case 'rect':
      return { ...entity, origin: shift(entity.origin) };
    case 'circle':
    case 'arc':
      return { ...entity, center: shift(entity.center) };
    case 'line':
      return { ...entity, start: shift(entity.start), end: shift(entity.end) };
    case 'path':
      return { ...entity, points: entity.points.map(shift) };
  }
}

/**
 * Moves every entity named in `ids` by `deltaMm`.
 *
 * A zero delta, an empty id set, or ids that match nothing all return the SAME
 * sketch object, so a drag that has not moved yet costs nothing and cannot be
 * mistaken for a change.
 */
export function translateEntities(sketch: Sketch, ids: ReadonlySet<string>, deltaMm: Vec2): Sketch {
  if (ids.size === 0) return sketch;
  if (deltaMm.x === 0 && deltaMm.y === 0) return sketch;
  if (!Number.isFinite(deltaMm.x) || !Number.isFinite(deltaMm.y)) return sketch;
  let changed = false;
  const entities = sketch.entities.map((entity) => {
    if (!ids.has(entity.id)) return entity;
    changed = true;
    return translateEntity(entity, deltaMm);
  });
  return changed ? { ...sketch, entities } : sketch;
}
