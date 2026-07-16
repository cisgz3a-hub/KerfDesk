// core/shapes — pure geometry for the on-canvas drawing primitives (ADR-051,
// Phase G). Shape factories preserve canonical curves and retain deterministic
// compatibility polylines for subsystems still migrating to schema-v2 geometry.
//
// The parametric primitives (rectangle/ellipse/polygon/star) live in the
// ./primitives sub-barrel (core/shapes/primitives) — split out to keep this
// barrel under the public-export cap (ADR-015).

export {
  rematerializeParametricShape,
  sanitizeParametricShapeSpec,
  type ParametricShapeSpec,
} from './rematerialize-shape';
export { polylineToPolylines } from './polyline';
export type { PolylineSpec } from './polyline';
export { createPolyline, CURRENT_POLYLINE_FAIRING_VERSION } from './create-polyline';
export { shapeFromDrag, isDrawDragSignificant, MIN_DRAW_SIZE_MM } from './shape-from-drag';
export type { DrawShapeKind, DrawShapeModifiers } from './shape-from-drag';
export {
  createRegistrationBox,
  createRegistrationCircle,
  REGISTRATION_BOX_OBJECT_ID,
} from './registration-box';
