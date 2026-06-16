// core/shapes — pure geometry for the on-canvas drawing primitives (ADR-051,
// Phase G). Each shape converts a parametric spec into polylines that the
// kind:'shape' SceneObject variant materializes into paths; compile/preview/emit
// stay untouched.

export { rectangleToPolylines } from './rectangle';
export type { RectangleSpec } from './rectangle';
export { createRectangle } from './create-rectangle';
export { ellipseSegmentCount, ellipseToPolylines } from './ellipse';
export type { EllipseSpec } from './ellipse';
export { createEllipse } from './create-ellipse';
export { polygonToPolylines } from './polygon';
export type { PolygonSpec } from './polygon';
export { createPolygon } from './create-polygon';
export { polylineToPolylines } from './polyline';
export type { PolylineSpec } from './polyline';
export { createPolyline } from './create-polyline';
export { shapeFromDrag, isDrawDragSignificant, MIN_DRAW_SIZE_MM } from './shape-from-drag';
export type { DrawShapeKind, DrawShapeModifiers } from './shape-from-drag';
