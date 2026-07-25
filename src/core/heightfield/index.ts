// core/heightfield — turns a heightfield into renderable mesh geometry.
// Pure: plain typed arrays only, so the 3D viewport's geometry is testable
// without WebGL (ADR-102 §2, ADR-261).

export { steppedSurfaceMesh, type SteppedSurfaceMesh } from './stepped-surface-mesh';
