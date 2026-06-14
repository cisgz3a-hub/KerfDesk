// core/shapes — pure geometry for the on-canvas drawing primitives (ADR-051,
// Phase G). Each shape converts a parametric spec into polylines that the
// kind:'shape' SceneObject variant materializes into paths; compile/preview/emit
// stay untouched.

export { rectangleToPolylines } from './rectangle';
export type { RectangleSpec } from './rectangle';
export { createRectangle } from './create-rectangle';
