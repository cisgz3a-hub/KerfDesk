// core/design — the pure sketch model behind the Design Studio (ADR-268,
// Phase N). Cross-module consumers (ui/design-studio) import from here, never
// from the leaf files; intra-module code imports leaves directly.
//
// This barrel is deliberately kept well under the ADR-015 hard cap of 20
// symbols. The snap engine and the modify operations get their OWN sub-barrels
// (core/design/snap, core/design/ops) rather than growing this one — the same
// split core/shapes/primitives made, and the reason core/design exists as a new
// module at all: core/scene/index.ts is ratcheted at 208 exports and
// core/geometry/index.ts is already at the cap.

export type {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchEntity,
  SketchLine,
  SketchPath,
  SketchRectangle,
} from './sketch-entity';
export { EMPTY_SKETCH, MIN_ENTITY_SIZE_MM, sanitizeEntity } from './sketch-entity';
export { entityToPolylines } from './entity-geometry';
export { designEntityToSceneObject } from './to-scene-object';
export { entityBounds, outputSketchBounds, sketchBounds } from './sketch-bounds';
export { addEntity, findEntity, removeEntities, replaceEntity } from './sketch-edit';
