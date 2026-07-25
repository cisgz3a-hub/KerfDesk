// ui/viewer3d — three.js drawables for the CNC 3D viewport (ADR-254 §1).
// Display-only: nothing here may gate or refuse an operator action (§3).

export { buildToolpathLines, type ToolpathLinesHandle } from './viewer3d-toolpath';
export { toolpathLineStyle, type ToolpathLineStyle } from './viewer3d-toolpath-colors';
