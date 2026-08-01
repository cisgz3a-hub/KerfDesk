// ui/viewer3d — three.js drawables for the CNC 3D viewport (ADR-261 §1).
// Display-only: nothing here may gate or refuse an operator action (§3).

export {
  buildViewerContent,
  type ViewerContentHandle,
  type ViewerContentInput,
  type ViewerSurfaceMesh,
  type ViewerToolpathOverlay,
} from './viewer3d-content';
export { buildStageFurniture, type StageFurnitureHandle } from './viewer3d-stage';
export { buildToolMesh, type ToolMeshHandle } from './viewer3d-tool';
export { buildToolpathLines, type ToolpathLinesHandle } from './viewer3d-toolpath';
export { toolpathLineStyle, type ToolpathLineStyle } from './viewer3d-toolpath-colors';
