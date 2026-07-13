// core/shapes — pure geometry for the on-canvas drawing primitives (ADR-051,
// Phase G). Shape factories preserve canonical curves and retain deterministic
// compatibility polylines for subsystems still migrating to schema-v2 geometry.

export { rectangleToCurve, rectangleToPolylines } from './rectangle';
export type { RectangleSpec } from './rectangle';
export { createRectangle } from './create-rectangle';
export { ellipseSegmentCount, ellipseToCurve, ellipseToPolylines } from './ellipse';
export type { EllipseSpec } from './ellipse';
export { createEllipse } from './create-ellipse';
export { polygonToPolylines } from './polygon';
export type { PolygonSpec } from './polygon';
export { createPolygon } from './create-polygon';
export { starToPolylines } from './star';
export type { StarSpec } from './star';
export { createStar } from './create-star';
export {
  rematerializeParametricShape,
  sanitizeParametricShapeSpec,
  type ParametricShapeSpec,
} from './rematerialize-shape';
export { polylineToPolylines } from './polyline';
export type { PolylineSpec } from './polyline';
export { createPolyline } from './create-polyline';
export { shapeFromDrag, isDrawDragSignificant, MIN_DRAW_SIZE_MM } from './shape-from-drag';
export type { DrawShapeKind, DrawShapeModifiers } from './shape-from-drag';
export {
  createRegistrationBox,
  createRegistrationCircle,
  REGISTRATION_BOX_OBJECT_ID,
} from './registration-box';
