// core/shapes/primitives — the parametric primitive shapes (rectangle, ellipse,
// polygon, star): each factory preserves canonical curves and retains
// deterministic compatibility polylines for subsystems still migrating to
// schema-v2 geometry (ADR-051, Phase G). Split out of core/shapes so that barrel
// stays under the public-export cap (ADR-015).

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
