// sketch-edit — returns a new sketch with one structural change applied
// (ADR-268, Phase N DS-1). Every function is pure and total: nothing mutates,
// nothing throws, and an edit that cannot apply returns the sketch unchanged so
// the caller never has to branch on failure.
//
// Entity order is z-order: later entities draw on top and hit-test first. Edits
// preserve it, because a design surface where shapes reshuffle themselves is
// unusable.

import { sanitizeEntity, type Sketch, type SketchEntity } from './sketch-entity';

export function findEntity(sketch: Sketch, id: string): SketchEntity | null {
  return sketch.entities.find((entity) => entity.id === id) ?? null;
}

// A degenerate entity is dropped rather than added — a zero-length line is not
// an error, it is a click that never became a drag.
export function addEntity(sketch: Sketch, entity: SketchEntity): Sketch {
  const clean = sanitizeEntity(entity);
  if (clean === null) return sketch;
  if (findEntity(sketch, clean.id) !== null) return sketch;
  return { ...sketch, entities: [...sketch.entities, clean] };
}

export function addEntities(sketch: Sketch, entities: ReadonlyArray<SketchEntity>): Sketch {
  return entities.reduce(addEntity, sketch);
}

// Replaces in place, preserving z-order. An unknown id or a degenerate
// replacement leaves the sketch untouched.
export function replaceEntity(sketch: Sketch, entity: SketchEntity): Sketch {
  const index = sketch.entities.findIndex((candidate) => candidate.id === entity.id);
  if (index < 0) return sketch;
  const clean = sanitizeEntity(entity);
  if (clean === null) return sketch;
  const entities = [...sketch.entities];
  entities[index] = clean;
  return { ...sketch, entities };
}

export function removeEntities(sketch: Sketch, ids: ReadonlySet<string>): Sketch {
  if (ids.size === 0) return sketch;
  const entities = sketch.entities.filter((entity) => !ids.has(entity.id));
  return entities.length === sketch.entities.length ? sketch : { ...sketch, entities };
}

export function setEntityConstruction(sketch: Sketch, id: string, construction: boolean): Sketch {
  const entity = findEntity(sketch, id);
  if (entity === null) return sketch;
  return replaceEntity(sketch, { ...entity, construction });
}
